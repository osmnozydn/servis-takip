// KVKK aydınlatma metni ve açık rıza
//
// ⚠️ TASLAKTIR. Canlıya çıkmadan önce bir hukukçu tarafından gözden geçirilmeli;
// veri sorumlusu unvanı, adresi ve başvuru kanalı doldurulmalıdır.
// Metin değiştiğinde CONSENT_VERSION'ı artırın: tüm kullanıcılardan yeniden onay istenir.

import type { UserRole } from './index';

export const CONSENT_VERSION = 'kvkk-2026-10-v1';

export interface ConsentSection {
  title: string;
  body: string;
}

export function consentSections(role: UserRole): ConsentSection[] {
  const common: ConsentSection[] = [
    {
      title: 'Veri sorumlusu',
      body: 'Kişisel verileriniz, servis hizmetini sağlayan şirketiniz (veri sorumlusu) adına bu uygulama aracılığıyla işlenir. [Veri sorumlusu unvanı ve adresi eklenecek]',
    },
    {
      title: 'İşlenen veriler',
      body: role === 'driver'
        ? 'Ad soyad, kullanıcı adı, telefon numarası ve servis sırasında aracın anlık konumu (GPS), hızı ve yönü.'
        : role === 'passenger'
          ? 'Ad soyad, kullanıcı adı, telefon numarası, servis durağınızın konumu ve "bugün kullanmayacağım" bildirimleriniz.'
          : 'Ad soyad, kullanıcı adı ve telefon numarası.',
    },
    {
      title: 'İşleme amacı',
      body: 'Servis aracının konumunun yetkili yolculara gösterilmesi, güzergâhın durak sırasına göre planlanması ve servis hizmetinin yürütülmesi.',
    },
    {
      title: 'Aktarım',
      body: 'Veriler, altyapı hizmeti alınan yurt dışındaki sunucularda (Avrupa Birliği – Frankfurt) saklanır. Güzergâh hesaplaması için durak konumları harita hizmet sağlayıcısına (Google) iletilir.',
    },
    {
      title: 'Saklama süresi',
      body: 'Konum geçmişi sınırlı bir süre saklanır ve ardından silinir; hesap bilgileri hesabınız silinene kadar tutulur. [Kesin süreler eklenecek]',
    },
    {
      title: 'Haklarınız',
      body: 'KVKK m.11 kapsamında verilerinize erişme, düzeltilmesini veya silinmesini isteme ve rızanızı geri alma haklarınız vardır. Başvuru: [başvuru kanalı eklenecek]',
    },
  ];
  return common;
}

export function consentCheckboxLabel(role: UserRole): string {
  if (role === 'driver') {
    return 'Aydınlatma metnini okudum. Servis süresince konumumun işlenmesine ve yetkili yolcularla paylaşılmasına açık rıza veriyorum.';
  }
  return 'Aydınlatma metnini okudum ve kişisel verilerimin bu kapsamda işlenmesine açık rıza veriyorum.';
}
