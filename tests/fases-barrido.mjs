// Temporal: barrido de semillas de una fase (novato/medio/bueno)
import { FASES, Fase } from '../app/src/sim/fases.js';
import { resumen } from './fases.mjs';
const fase = +(process.argv[2] || 0), a = +(process.argv[3] || 2101), b = +(process.argv[4] || 2120), N = +(process.argv[5] || 12);
for (const x of process.argv.slice(6)) { const m = /^--(wave|stretch|len|ease)=([\d.]+)$/.exec(x); if (m) FASES[fase][m[1]] = +m[2]; }
for (let seed = a; seed <= b; seed++) {
  FASES[fase].seed = seed;
  const out = [];
  for (const lv of ['novato', 'medio', 'bueno']) { const s = resumen(fase, lv, N); out.push(`${lv[0]} ${String(s.en3).padStart(3)}% i${s.intentos} ${s.segs1 ?? '—'}s`); }
  console.log(seed, out.join(' · '));
}
