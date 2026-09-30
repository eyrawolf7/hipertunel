// Fantasma del Arcade: la mejor partida se guarda como semilla + lo que se pulsó en cada paso de 60 Hz
// (giro y piruetas). Como la simulación es determinista, basta con eso para repetirla exacta.
// No cambia nada de las reglas: el fantasma es una segunda simulación que corre en paralelo y solo
// enseña dónde ibas tú en tu mejor partida (una marca translúcida, nunca en el centro de la vista).
import { Arcade } from './sim/arcade.js';

export const GHOST_KEY = 'hipertunel-fantasma-arcade';
const Q = 1000;   // el giro se juega y se guarda en milésimas: lo que se juega es exactamente lo que se repite

export const quantGhost = (a) => Math.max(-32000, Math.min(32000, Math.round(a * Q))) / Q;

// graba los pasos en los que el jugador manda de verdad (partida viva)
export class GhostRecorder {
  constructor({ seed, easy }) { this.seed = seed; this.easy = easy; this.steers = []; this.tricks = []; }
  push(steer, trick) { if (trick) this.tricks.push(this.steers.length); this.steers.push(Math.round(steer * Q)); }
  // fin: { rows, score, distM } de la partida grabada (sirve para comprobar que el repaso coincide)
  pack(fin) {
    const b = new Uint8Array(this.steers.length * 2);
    for (let i = 0; i < this.steers.length; i++) { const v = this.steers[i] & 0xffff; b[2 * i] = v & 255; b[2 * i + 1] = v >> 8; }
    let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return { v: 1, seed: this.seed, easy: this.easy, n: this.steers.length, steers: btoa(s), tricks: this.tricks, ...fin };
  }
}

// null si el dato no sirve (otra versión, corrupto…)
export function unpackRun(o) {
  try {
    if (!o || o.v !== 1 || !Number.isFinite(o.seed) || !(o.n > 0) || typeof o.steers !== 'string') return null;
    const s = atob(o.steers);
    if (s.length !== o.n * 2) return null;
    const steers = new Float64Array(o.n);
    for (let i = 0; i < o.n; i++) { const v = s.charCodeAt(2 * i) | (s.charCodeAt(2 * i + 1) << 8); steers[i] = (v > 32767 ? v - 65536 : v) / Q; }
    return { seed: o.seed, easy: o.easy | 0, n: o.n, steers, tricks: new Set(o.tricks || []), rows: o.rows, score: o.score, distM: o.distM };
  } catch (e) { return null; }
}

export const newGhostGame = (run) => new Arcade({ seed: run.seed, easyWalls: run.easy });

// un paso del fantasma: las mismas entradas que se grabaron en ese fotograma
export function stepGhost(g, run) {
  const i = g.frame;
  return g.step({ steer: i < run.n ? run.steers[i] : 0, trick: run.tricks.has(i) });
}

// ¿el repaso llegó al mismo sitio? (si las reglas cambian entre versiones, el fantasma se desecha)
export const ghostMatches = (g, run) => !g.alive && g.rowsPassed === run.rows && g.frame === run.n;

// repite la partida entera y devuelve la partida final (para pruebas y para validar un dato guardado)
export function replayRun(run) {
  const g = newGhostGame(run);
  while (g.alive && g.frame < run.n + 600) stepGhost(g, run);
  return g;
}
