// Giriş ekranı çizimi: bir servis güzergâhı, durakları sırayla uğrayan araç.
// Hareket tek ve yavaştır; "hareketi azalt" tercihinde araç son durakta sabit durur.
import { useMemo } from 'react';

const PATH = 'M 30 210 C 90 210 100 150 160 140 S 250 170 290 120 S 370 40 430 70 S 520 150 545 90';
const STOPS: [number, number][] = [[30, 210], [160, 140], [290, 120], [430, 70]];

export function RouteArt() {
  const reduce = useMemo(() => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches, []);
  return (
    <svg className="route-art" viewBox="0 0 580 250" role="img" aria-label="Duraklara sırayla uğrayan servis güzergâhı">
      {/* sokak dokusu */}
      <g stroke="#1E4366" strokeWidth="1">
        {Array.from({ length: 9 }, (_, i) => <line key={`v${i}`} x1={i * 70 + 10} y1="0" x2={i * 70 - 30} y2="250" />)}
        {Array.from({ length: 5 }, (_, i) => <line key={`h${i}`} x1="0" y1={i * 58 + 18} x2="580" y2={i * 58 + 30} />)}
      </g>
      <path d={PATH} fill="none" stroke="#24507A" strokeWidth="14" strokeLinecap="round" />
      <path d={PATH} fill="none" stroke="#F2A900" strokeWidth="3" strokeDasharray="10 9" strokeLinecap="round" />
      {STOPS.map(([x, y], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r="13" fill="#102C47" stroke="#fff" strokeWidth="2.5" />
          <text x={x} y={y + 4.5} textAnchor="middle" fill="#fff" fontFamily="Barlow Semi Condensed, sans-serif" fontWeight="600" fontSize="13">{i + 1}</text>
        </g>
      ))}
      {/* varış: fabrika / okul */}
      <g transform="translate(545 90)">
        <rect x="-15" y="-15" width="30" height="30" rx="7" fill="#F2A900" />
        <path d="M -7 6 V -2 L -2 1 V -2 L 3 1 V -6 H 7 V 6 Z" fill="#102C47" />
      </g>
      {/* araç */}
      <g>
        <rect x="-15" y="-9" width="30" height="18" rx="5" fill="#fff" />
        <rect x="-11" y="-5" width="14" height="6" rx="1.5" fill="#1F4E79" />
        <rect x="6" y="-5" width="6" height="6" rx="1.5" fill="#1F4E79" />
        {reduce
          ? <animateMotion dur="0.01s" fill="freeze" path={PATH} keyPoints="0.37;0.37" keyTimes="0;1" calcMode="linear" rotate="auto" />
          : <animateMotion dur="14s" repeatCount="indefinite" path={PATH} rotate="auto"
              keyPoints="0;0;0.253;0.253;0.486;0.486;0.761;0.761;1;1" keyTimes="0;0.06;0.24;0.3;0.46;0.52;0.7;0.76;0.94;1" calcMode="linear" />}
      </g>
    </svg>
  );
}
