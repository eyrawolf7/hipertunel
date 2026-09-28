// Dibuja el icono de la app (túnel de 12 caras con avisos y una placa de impulso) y lo guarda en
// assets/ para @capacitor/assets. Uso: node tools/icono.mjs
import puppeteer from 'puppeteer';
const N = 12, cx = 512, cy = 540;
const ring = (r) => Array.from({ length: N }, (_, i) => { const a = (i + 0.5) / N * Math.PI * 2; return [cx + Math.sin(a) * r, cy + Math.cos(a) * r]; });
const R = [900, 560, 360, 235, 150, 95, 60];
let polys = '';
const colors = { 2: '#ff3d57', 5: '#ffc21a', 8: '#22d08a', 10: '#ff5fb4' };
for (let k = 0; k < R.length - 1; k++) {
  const A = ring(R[k]), B = ring(R[k + 1]);
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    const lit = colors[i] && k < 4 ? colors[i] : null;
    const shade = 0.93 - k * 0.07;
    const base = `rgb(${Math.round(255 * shade)},${Math.round(250 * shade)},${Math.round(242 * shade)})`;
    polys += `<polygon points="${[A[i], A[j], B[j], B[i]].map((p) => p.join(',')).join(' ')}" fill="${lit || base}" stroke="#2a2350" stroke-width="${10 - k * 1.3}" stroke-linejoin="round"/>`;
  }
}
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
<defs><radialGradient id="g" cx="50%" cy="52%" r="10%"><stop offset="0" stop-color="#fff6d6"/><stop offset="1" stop-color="#ffc98f" stop-opacity="0"/></radialGradient>
<clipPath id="c"><rect width="1024" height="1024" rx="0"/></clipPath></defs>
<g clip-path="url(#c)"><rect width="1024" height="1024" fill="#2b2257"/>${polys}<circle cx="${cx}" cy="${cy}" r="120" fill="url(#g)"/>
<g transform="translate(512 860) scale(1.25)"><path d="M-150 60 L150 60 L95 -60 L-95 -60 Z" fill="#0a5cff" stroke="#fff" stroke-width="14" stroke-linejoin="round"/>
<path d="M-70 35 L0 -25 L70 35" fill="none" stroke="#fff" stroke-width="22" stroke-linecap="round" stroke-linejoin="round"/></g></g></svg>`;
const b = await puppeteer.launch({ headless: 'new' });
const p = await b.newPage(); await p.setViewport({ width: 1024, height: 1024 });
await p.setContent(`<html><body style="margin:0">${svg}</body></html>`);
await p.screenshot({ path: 'assets/icon-only.png' });
await p.setContent(`<html><body style="margin:0;background:#2b2257"><div style="transform:scale(.62);transform-origin:50% 50%">${svg}</div></body></html>`);
await p.screenshot({ path: 'assets/icon-foreground.png' });
await p.setContent(`<html><body style="margin:0;background:#2b2257;width:1024px;height:1024px"></body></html>`);
await p.screenshot({ path: 'assets/icon-background.png' });
await b.close();
console.log('assets/icon-*.png');
