// Recorta las piezas de una hoja de ChatGPT (PNG con transparencia) y las guarda como WebP.
// Las piezas se buscan como islas del canal alfa (con un poco de margen para que las hojas
// sueltas se queden con su pieza) y se nombran en orden de lectura (filas de arriba abajo y, en
// cada fila, de izquierda a derecha).
// Uso: node tools/ui/recortar.mjs <hoja.png> <carpeta> nombre1 nombre2 ... [--max=1400] [--q=0.88]
//   --cut=y0-y1: si dos piezas se tocan, las separa por la fila menos pintada de ese tramo.
//   --cutx=x0-x1@y0-y1: lo mismo en vertical, solo entre las filas y0 e y1.
//   nombre "-" = descartar esa pieza. Si sale un número de piezas distinto, avisa y no guarda.
import puppeteer from 'puppeteer';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? '1']; }));
const [src, out, ...names] = args.filter((a) => !a.startsWith('--'));
const MAX = +(opt.max || 1400), Q = +(opt.q || 0.88), GAP = +(opt.gap || 10);
mkdirSync(out, { recursive: true });

const b = await puppeteer.launch({ headless: 'new' });
const p = await b.newPage();
const data = 'data:image/png;base64,' + readFileSync(src).toString('base64');
const res = await p.evaluate(async (data, MAX, Q, GAP, CUT, CUTX) => {
  const img = new Image(); img.src = data; await img.decode();
  const W = img.width, H = img.height;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d'); x.drawImage(img, 0, 0);
  if (CUT) {
    const [a, b2] = CUT.split('-').map(Number), all = x.getImageData(0, 0, W, H).data;
    let best = a, bn = 1e9;
    for (let y = a; y <= b2; y++) { let n = 0; for (let X = 0; X < W; X++) if (all[(y * W + X) * 4 + 3] > 24) n++; if (n < bn) { bn = n; best = y; } }
    x.clearRect(0, best - 5, W, 10);   // 10 px: más que una celda de la máscara (4 px) a cada lado
  }
  if (CUTX) {
    const [xr, yr] = CUTX.split('@'), [a, b2] = xr.split('-').map(Number), [ya, yb] = yr.split('-').map(Number);
    const all = x.getImageData(0, 0, W, H).data;
    let best = a, bn = 1e9;
    for (let X = a; X <= b2; X++) { let n = 0; for (let y = ya; y <= yb; y++) if (all[(y * W + X) * 4 + 3] > 24) n++; if (n < bn) { bn = n; best = X; } }
    x.clearRect(best - 5, ya, 10, yb - ya);
  }
  const px = x.getImageData(0, 0, W, H).data;
  // máscara reducida (1/4) con dilatación de GAP px
  const S = 4, w = Math.ceil(W / S), h = Math.ceil(H / S);
  const m = new Uint8Array(w * h);
  for (let y = 0; y < H; y++) for (let X = 0; X < W; X++) if (px[(y * W + X) * 4 + 3] > 24) m[((y / S) | 0) * w + ((X / S) | 0)] = 1;
  const r = Math.ceil(GAP / S), d = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let X = 0; X < w; X++) if (m[y * w + X]) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const yy = y + dy, xx = X + dx; if (yy >= 0 && yy < h && xx >= 0 && xx < w) d[yy * w + xx] = 1; }
  const lab = new Int32Array(w * h), boxes = [];
  for (let i = 0; i < w * h; i++) {
    if (!d[i] || lab[i]) continue;
    const id = boxes.length + 1, st = [i]; lab[i] = id;
    let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, n = 0;
    while (st.length) {
      const k = st.pop(), ky = (k / w) | 0, kx = k % w; n++;
      if (m[k]) { x0 = Math.min(x0, kx); y0 = Math.min(y0, ky); x1 = Math.max(x1, kx); y1 = Math.max(y1, ky); }
      for (const q of [k - 1, k + 1, k - w, k + w]) if (q >= 0 && q < w * h && d[q] && !lab[q] && Math.abs((q % w) - kx) <= 1) { lab[q] = id; st.push(q); }
    }
    if (x1 >= 0 && n > 200) boxes.push({ id, x0: x0 * S, y0: y0 * S, x1: Math.min(W, (x1 + 1) * S), y1: Math.min(H, (y1 + 1) * S) });
  }
  // orden de lectura: filas por solape vertical
  boxes.sort((a, b) => a.y0 - b.y0);
  const rows = [];
  for (const bx of boxes) { const row = rows.find((r) => bx.y0 < r.y1 - (r.y1 - r.y0) * 0.3); if (row) { row.items.push(bx); row.y1 = Math.max(row.y1, bx.y1); } else rows.push({ y0: bx.y0, y1: bx.y1, items: [bx] }); }
  const ordered = rows.flatMap((r) => r.items.sort((a, b) => a.x0 - b.x0));
  const outs = ordered.map((bx) => {
    const bw = bx.x1 - bx.x0, bh = bx.y1 - bx.y0, k = Math.min(1, MAX / bw);
    // solo los píxeles de su isla (lo de las piezas vecinas que cae en el rectángulo, fuera)
    const t = document.createElement('canvas'); t.width = bw; t.height = bh;
    const tx = t.getContext('2d'); tx.drawImage(c, bx.x0, bx.y0, bw, bh, 0, 0, bw, bh);
    const td = tx.getImageData(0, 0, bw, bh);
    for (let y = 0; y < bh; y++) for (let X = 0; X < bw; X++) if (lab[(((bx.y0 + y) / S) | 0) * w + (((bx.x0 + X) / S) | 0)] !== bx.id) td.data[(y * bw + X) * 4 + 3] = 0;
    tx.putImageData(td, 0, 0);
    const o = document.createElement('canvas'); o.width = Math.round(bw * k); o.height = Math.round(bh * k);
    const ox = o.getContext('2d'); ox.imageSmoothingQuality = 'high';
    ox.drawImage(t, 0, 0, bw, bh, 0, 0, o.width, o.height);
    return { box: bx, w: o.width, h: o.height, url: o.toDataURL('image/webp', Q) };
  });
  return { W, H, outs };
}, data, MAX, Q, GAP, opt.cut || '', opt.cutx || '');
await b.close();

console.log(`${src}: ${res.W}×${res.H}, ${res.outs.length} piezas`);
res.outs.forEach((o, i) => console.log(`  ${i + 1}. ${names[i] || '?'}  ${o.w}×${o.h}  (en la hoja: ${o.box.x0},${o.box.y0} → ${o.box.x1},${o.box.y1})`));
if (names.length && names.length !== res.outs.length) { console.log(`Esperaba ${names.length} piezas: no guardo nada (prueba --gap=)`); process.exit(1); }
let total = 0;
res.outs.forEach((o, i) => {
  const n = names[i] || `pieza-${i + 1}`; if (n === '-') return;
  const buf = Buffer.from(o.url.split(',')[1], 'base64'); total += buf.length;
  writeFileSync(`${out}/${n}.webp`, buf);
});
console.log(`Guardado en ${out} (${(total / 1024).toFixed(0)} KB)`);
