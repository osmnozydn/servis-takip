// Yönetim paneli ortak bileşenleri
import { useEffect, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import {
  ACCEPT, daysUntil, genPassword as genPasswordLocal, deleteDocument, DOC_COLUMNS, DOC_HAS_EXPIRY, DOC_LABEL, fmtDay, isPhotoType, signedUrls, uploadDocument,
  type DocRow, type DocType, type OwnerType,
} from './common';

export function Field({ label, children, hint, wide }: { label: string; children: ReactNode; hint?: string; wide?: boolean }) {
  return (
    <label className={wide ? 'span2' : undefined}>
      {label}
      {children}
      {hint && <small className="muted hint">{hint}</small>}
    </label>
  );
}

export function Notice({ kind, children }: { kind: 'ok' | 'err' | 'info'; children: ReactNode }) {
  return <div className={`notice ${kind}`}>{children}</div>;
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="ghost small" onClick={async () => {
      try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* yoksay */ }
    }}>{done ? 'Kopyalandı ✓' : 'Kopyala'}</button>
  );
}

/** Yeni hesabın giriş bilgileri — kişiye iletilecek */
export function CredentialsBox({ title, companyCode, username, password, note }: {
  title: string; companyCode: string; username: string; password: string; note?: string;
}) {
  const text = `Servis Takip giriş bilgileriniz\nŞirket kodu: ${companyCode}\nKullanıcı adı: ${username}\nGeçici şifre: ${password}\nİlk girişte şifrenizi değiştirmeniz istenecek.`;
  return (
    <div className="cred">
      <div className="cred-head"><b>{title}</b><CopyButton text={text} /></div>
      <dl>
        <dt>Şirket kodu</dt><dd>{companyCode}</dd>
        <dt>Kullanıcı adı</dt><dd>{username}</dd>
        <dt>Geçici şifre</dt><dd className="mono">{password}</dd>
      </dl>
      <small className="muted">{note ?? 'Bu bilgileri kişiye iletin. İlk girişte şifresini değiştirmesi istenecek. Şifre bir daha gösterilmez.'}</small>
    </div>
  );
}

// ---------------------------------------------------------------------
// Kayıt sırasında belge seçimi (kayıt tamamlanınca yüklenir)
// ---------------------------------------------------------------------
export type DocDraft = { file: File | null; expires: string };
export type DocDrafts = Partial<Record<DocType, DocDraft>>;

export function DocDraftPicker({ types, value, onChange }: { types: DocType[]; value: DocDrafts; onChange: (v: DocDrafts) => void }) {
  const set = (t: DocType, patch: Partial<DocDraft>) =>
    onChange({ ...value, [t]: { file: value[t]?.file ?? null, expires: value[t]?.expires ?? '', ...patch } });
  return (
    <div className="docdrafts">
      {types.map((t) => {
        const d = value[t];
        return (
          <div className="docdraft" key={t}>
            <div className="dd-label">{DOC_LABEL[t]}{isPhotoType(t) && <span className="muted"> (fotoğraf)</span>}</div>
            <label className="filebtn">
              <input type="file" accept={isPhotoType(t) ? 'image/*' : ACCEPT} onChange={(e) => set(t, { file: e.target.files?.[0] ?? null })} />
              <span>{d?.file ? d.file.name : 'Dosya seç…'}</span>
            </label>
            {DOC_HAS_EXPIRY[t] ? (
              <input type="date" title="Son geçerlilik tarihi" value={d?.expires ?? ''} onChange={(e) => set(t, { expires: e.target.value })} />
            ) : <span />}
            {d?.file ? <button type="button" className="link" onClick={() => set(t, { file: null })}>Kaldır</button> : <span />}
          </div>
        );
      })}
      <small className="muted">Fotoğraf (JPG, PNG, HEIC) veya PDF, en fazla 10 MB. Tarih alanı belgenin son geçerlilik tarihidir.</small>
    </div>
  );
}

/** Taslak belgeleri yükler; hata mesajlarını döndürür */
export async function uploadDrafts(companyId: string, ownerType: OwnerType, ownerId: string, drafts: DocDrafts): Promise<string[]> {
  const errors: string[] = [];
  for (const [t, d] of Object.entries(drafts) as [DocType, DocDraft][]) {
    if (!d?.file) continue;
    const r = await uploadDocument(companyId, ownerType, ownerId, t, d.file, d.expires || null);
    if (!r.ok) errors.push(r.message);
  }
  return errors;
}
export const draftCount = (d: DocDrafts) => Object.values(d).filter((x) => x?.file).length;

// ---------------------------------------------------------------------
// Kayıtlı belgeler: listele, görüntüle, yenisini yükle, sil
// ---------------------------------------------------------------------
export function ExpiryTag({ date }: { date: string | null }) {
  const d = daysUntil(date);
  if (d === null) return <span className="muted">—</span>;
  if (d < 0) return <span className="tag missed">{fmtDay(date)} · süresi doldu</span>;
  if (d <= 30) return <span className="tag pending">{fmtDay(date)} · {d} gün kaldı</span>;
  return <span>{fmtDay(date)}</span>;
}

export function DocumentsPanel({ companyId, ownerType, ownerId, types, onChange }: {
  companyId: string; ownerType: OwnerType; ownerId: string; types: DocType[]; onChange?: () => void;
}) {
  const [docs, setDocs] = useState<DocRow[] | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [type, setType] = useState<DocType>(types[0]);
  const [file, setFile] = useState<File | null>(null);
  const [expires, setExpires] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [inputKey, setInputKey] = useState(0);

  async function load() {
    const { data } = await supabase.from('documents').select(DOC_COLUMNS)
      .eq('owner_type', ownerType).eq('owner_id', ownerId).order('created_at', { ascending: false });
    const list = (data ?? []) as DocRow[];
    setDocs(list);
    setUrls(await signedUrls(list.map((d) => d.file_path)));
  }
  useEffect(() => { void load(); }, [ownerType, ownerId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function upload() {
    if (!file) return;
    setBusy(true); setMsg(null);
    const r = await uploadDocument(companyId, ownerType, ownerId, type, file, expires || null);
    setBusy(false);
    if (!r.ok) { setMsg({ kind: 'err', text: r.message }); return; }
    setMsg({ kind: 'ok', text: `${DOC_LABEL[type]} yüklendi.` });
    setFile(null); setExpires(''); setInputKey((k) => k + 1);
    await load(); onChange?.();
  }
  async function remove(d: DocRow) {
    if (!confirm(`${DOC_LABEL[d.doc_type]} silinsin mi?`)) return;
    if (await deleteDocument(d)) { await load(); onChange?.(); }
  }

  const photos = (docs ?? []).filter((d) => isPhotoType(d.doc_type));
  const others = (docs ?? []).filter((d) => !isPhotoType(d.doc_type));
  return (
    <div className="docs">
      {docs === null ? <p className="muted">Belgeler yükleniyor…</p> : (
        <>
          {photos.length > 0 && (
            <div className="photos">
              {photos.map((d) => (
                <figure key={d.id}>
                  {urls[d.file_path] ? <a href={urls[d.file_path]} target="_blank" rel="noreferrer"><img src={urls[d.file_path]} alt={DOC_LABEL[d.doc_type]} /></a> : <div className="ph" />}
                  <figcaption>{DOC_LABEL[d.doc_type]} <button className="link" onClick={() => remove(d)}>Sil</button></figcaption>
                </figure>
              ))}
            </div>
          )}
          {others.length > 0 ? (
            <div className="tablewrap">
              <table>
                <thead><tr><th>Belge</th><th>Son geçerlilik</th><th>Yüklendi</th><th /></tr></thead>
                <tbody>{others.map((d) => (
                  <tr key={d.id}>
                    <td>{urls[d.file_path] ? <a href={urls[d.file_path]} target="_blank" rel="noreferrer">{DOC_LABEL[d.doc_type]}</a> : DOC_LABEL[d.doc_type]}</td>
                    <td><ExpiryTag date={d.expires_on} /></td>
                    <td>{fmtDay(d.created_at.slice(0, 10))}</td>
                    <td className="right"><button className="link danger" onClick={() => remove(d)}>Sil</button></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ) : photos.length === 0 && <p className="muted">Henüz belge yüklenmedi.</p>}
        </>
      )}
      <div className="docupload">
        <select value={type} onChange={(e) => setType(e.target.value as DocType)}>
          {types.map((t) => <option key={t} value={t}>{DOC_LABEL[t]}</option>)}
        </select>
        <label className="filebtn">
          <input key={inputKey} type="file" accept={ACCEPT} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <span>{file ? file.name : 'Dosya seç…'}</span>
        </label>
        {DOC_HAS_EXPIRY[type] && <input type="date" title="Son geçerlilik tarihi" value={expires} onChange={(e) => setExpires(e.target.value)} />}
        <button type="button" className="small" disabled={!file || busy} onClick={upload}>{busy ? 'Yükleniyor…' : 'Yükle'}</button>
      </div>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
    </div>
  );
}

/** Fotoğraf küçük resmi (sürücü / araç listesi) */
export function useThumbs(ownerType: OwnerType, docType: DocType, ownerIds: string[]) {
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const key = ownerIds.join(',');
  useEffect(() => {
    if (!ownerIds.length) { setThumbs({}); return; }
    supabase.from('documents').select('owner_id, file_path, created_at').eq('owner_type', ownerType).eq('doc_type', docType)
      .in('owner_id', ownerIds).order('created_at', { ascending: false })
      .then(async ({ data }) => {
        const latest: Record<string, string> = {};
        for (const d of data ?? []) latest[d.owner_id] ??= d.file_path;
        const urls = await signedUrls(Object.values(latest));
        const out: Record<string, string> = {};
        for (const [owner, path] of Object.entries(latest)) if (urls[path]) out[owner] = urls[path];
        setThumbs(out);
      });
  }, [ownerType, docType, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return thumbs;
}

export function Avatar({ url, name }: { url?: string; name: string }) {
  if (url) return <img className="avatar" src={url} alt="" />;
  const initials = name.split(/\s+/).filter((w) => /^\p{L}/u.test(w)).map((w) => w[0]).slice(0, 2).join('').toLocaleUpperCase('tr-TR');
  return <span className="avatar ini">{initials}</span>;
}

export function PasswordField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="inline">
      <input className="mono" value={value} onChange={(e) => onChange(e.target.value)} />
      <button type="button" className="ghost small" onClick={() => onChange(genPasswordLocal())}>Yeni üret</button>
    </div>
  );
}

/** Türk plakası görünümünde plaka */
export function Plate({ plate, size }: { plate: string; size?: 'lg' }) {
  return <span className={`plate ${size ?? ''}`} aria-label={`Plaka ${plate}`}><span className="tr">TR</span><span className="no">{plate}</span></span>;
}
