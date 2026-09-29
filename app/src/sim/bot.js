// Piloto automático: se usa en la demo de la pantalla de título y en las pruebas.
import { LANES, laneAngle } from './game.js';

export function botSteer(g, look = 14) {
  const cur = Math.floor(g.s);
  const danger = new Array(LANES).fill(0);
  for (const b of g.boxes) {
    if (b.hit) continue;
    const d = b.k - cur;
    if (d < -1 || d > look) continue;
    const w = 1 / (1 + Math.max(0, d));
    const lanes = [b.lane];
    if (!b.fixed) lanes.push((b.lane + Math.sign(b.rollSpeed) + LANES) % LANES);
    if (b.opp >= 0) lanes.push(b.opp);
    for (const l of lanes) { danger[l] += 10 * w; danger[(l + 1) % LANES] += 0.8 * w; danger[(l + LANES - 1) % LANES] += 0.8 * w; }
  }
  // Aventura: huecos y carriles que se están agrietando también son peligro
  if (g.isHole) {
    for (let d = 0; d <= look; d++) for (let l = 0; l < LANES; l++) if (g.isHole(cur + d, l)) danger[l] += 12 / (1 + d);
    for (let l = 0; l < LANES; l++) { const w = g.wearAt(cur + 1, l); if (w > 0.4) danger[l] += 6 * w; }
  }
  const bonus = new Array(LANES).fill(0);
  for (const p of g.pads) { const d = p.k - cur; if (!p.taken && d >= 0 && d < look) bonus[p.lane] += 3 / (1 + d); }
  const th = g.theta;
  const open = g.fold !== 30 && g.fold !== -30;
  let best = 0, bestScore = -1e9;
  for (let l = 0; l < LANES; l++) {
    let da = laneAngle(l) - th;
    if (!open) da = Math.atan2(Math.sin(da), Math.cos(da));
    const score = -danger[l] + bonus[l] - Math.abs(da) * 0.4;
    if (score > bestScore) { bestScore = score; best = l; }
  }
  let da = laneAngle(best) - th;
  if (!open) da = Math.atan2(Math.sin(da), Math.cos(da));
  const s = da * 0.35;
  return Math.max(-0.5, Math.min(0.5, s));
}

