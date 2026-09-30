// Modo Fases: el Arcade en tramos con final. Cada fase es un mundo con su semilla (el recorrido es
// siempre el mismo: se aprende y el fantasma tiene sentido), montado ENCIMA del Arcade sin tocar
// la simulación de Boost 2 ni arcade.js (nada que portar a C).
//
// - Una fase termina al aterrizar del salto entre mundos (el portal): ahí se gana. Ese salto es el
//   del plegado del guion, con sus piruetas.
// - Tres tramos: dos puntos de control. Al morir se vuelve al último con un impulso de regalo. Como
//   la simulación es determinista, «volver» es repetir las entradas guardadas hasta ese fotograma
//   (replay); el regalo va también en la grabación, así que un replay posterior lo reproduce.
// - Estrellas (bits, se suman entre intentos): 1 superada · 2 sin chocar · 4 el 35 % de las
//   monedas del camino y sin haber usado puntos de control.
import { Arcade } from './arcade.js';
import { quantSteer } from './adventure.js';

export const FASE_COIN_STAR = 0.35;   // parte de las monedas del camino para la tercera estrella

// wave: oleada del guion con la que empieza (la Selva empieza ya en el mundo 2, tras el primer
//   portal); world: valor de `world` de la simulación; theme: tema visual (0 islas, 1 selva…)
// len: filas hasta el portal con un jugador medio (ver tests/fases.mjs); los puntos de control caen
//   a 1/3 y 2/3
export const FASES = [
  { name: 'Islas del cielo', seed: 2121, wave: 0, world: 0, theme: 0, len: 1100, stretch: 1.2, ease: 0.8, easyWalls: 1, tip: 'Cartón: en el muro busca el bloque marrón y atraviésalo. Pirueta: toca al saltar entre mundos' },
  { name: 'Selva', seed: 2120, wave: 15, world: 2, theme: 1, len: 1100, stretch: 1.4, ease: 0.85, easyWalls: 0, tip: 'El musgo del suelo hace el giro más blando: gira con tiempo' },
];

export class Fase extends Arcade {
  constructor({ fase = 0 } = {}) {
    const f = FASES[fase];
    super({ seed: f.seed, easyWalls: f.easyWalls });
    this.faseIdx = fase; this.fase = f; this.isPhase = true;
    // las oleadas del Arcade van comprimidas (mundos en ~1 min): en una fase se alargan para que dure 60-90 s
    if (f.stretch) for (const w of this.waves) if (w.n > 0 && w.n < 1000) w.n = Math.max(6, Math.round(w.n * f.stretch));
    // ease: densidad de cajas de la fase respecto al Arcade (la primera es más suave)
    if (f.ease) for (const w of this.waves) { w.a *= f.ease; w.a0 *= f.ease; w.a1 *= f.ease; }
    this.waveLeft = this.wave.n;
    if (f.wave > 0) { this.waveIdx = f.wave; this.wave = this.waves[f.wave]; this.waveLeft = this.wave.n; this.gap = 20; this.curves = this.wave.curves; }
    this.world = f.world; this.seenWorld = f.world; this.themeN = f.theme;
    this.cps = [Math.round(f.len / 3), Math.round(2 * f.len / 3)];
    this.cpIdx = 0;              // puntos de control ya pasados
    this.gifts = 0;              // impulsos de regalo usados (= veces que se ha vuelto a un control)
    this.portal = null;          // tramo del salto final, cuando se conoce
    this.cleared = false;
    this.picked = 0;             // monedas del camino recogidas (sin las de piruetas ni cartón)
    this.coinsSpawned = 0;
    this._prog = 0;
  }

  // las monedas del camino que han salido hasta ahora (la tercera estrella se mide con ellas)
  spawnCoins(row) { const n = this.coins.length; super.spawnCoins(row); this.coinsSpawned += this.coins.length - n; }

  event(type, data) {
    if (type === 'coin') this.picked++;
    super.event(type, data);
  }

  // impulso de regalo al volver a un punto de control (la partida ya va en marcha: sube un nivel)
  gift() {
    this.gifts++;
    if (!this.boostOn || this.level < 1) this.initBoost();
  }

  step(input = {}) {
    if (input.gift) this.gift();
    const ev = super.step(input);
    if (!this.alive) return ev;
    // el salto entre mundos de la fase: se guarda al conocerse y se gana al aterrizar
    if (!this.portal && ev.some((e) => e.type === 'foldEnd') && this.inverted) this.portal = this.gaps[this.gaps.length - 1] || null;
    if (this.portal && this.s > this.portal.to + 1) {
      this.cleared = true; this.alive = false; this.event('clear', {});
      return this.events;
    }
    if (this.cpIdx < this.cps.length && this.s >= this.cps[this.cpIdx]) { this.cpIdx++; this.event('checkpoint', { n: this.cpIdx, frame: this.frame }); }
    return this.events;
  }

  // avance 0..1 hasta el portal (nunca retrocede)
  get progress() {
    const end = this.portal ? this.portal.to + 1 : this.fase.len * 1.05;
    this._prog = Math.max(this._prog, Math.min(this.cleared ? 1 : 0.99, this.s / end));
    return this._prog;
  }

  get coinGoal() { return Math.ceil(this.coinsSpawned * FASE_COIN_STAR); }
  // cada estrella es independiente: 1 superada, 2 sin chocar, 4 monedas sin puntos de control
  get starBits() {
    if (!this.cleared) return 0;
    let b = 1;
    if (this.crashes === 0) b |= 2;
    if (this.picked >= this.coinGoal && this.gifts === 0) b |= 4;
    return b;
  }
  get stars() { const b = this.starBits; return (b & 1) + ((b >> 1) & 1) + ((b >> 2) & 1); }
}

// ---------------------------------------------------------------- grabación y repetición
// Entradas de cada fotograma: giro cuantizado (igual que se juega), pirueta y regalo. Con eso la
// partida se repite exacta: fantasma y vuelta al punto de control.
export class Recording {
  constructor() { this.steer = []; this.trick = []; this.gift = []; }
  get length() { return this.steer.length; }
  push(steer, trick = false, gift = false) { this.steer.push(steer); this.trick.push(trick ? 1 : 0); this.gift.push(gift ? 1 : 0); }
  slice(n) { const r = new Recording(); r.steer = this.steer.slice(0, n); r.trick = this.trick.slice(0, n); r.gift = this.gift.slice(0, n); return r; }
  input(i) { return { steer: this.steer[i] ?? 0, trick: !!this.trick[i], gift: !!this.gift[i] }; }
}

// repite las primeras `n` entradas de la grabación en una partida nueva
export function replay(game, rec, n = rec.length) {
  for (let i = 0; i < n && game.alive; i++) game.step(rec.input(i));
  game.events = [];
  return game;
}

export { quantSteer };

// grabación → texto pequeño para guardarla (giros en base64, unos 3-6 KB por fase; piruetas y
// regalos como listas de fotogramas)
export function packRec(rec) {
  const b = new Uint8Array(rec.length);
  for (let i = 0; i < rec.length; i++) b[i] = Math.max(0, Math.min(255, Math.round(rec.steer[i] * 200) + 128));
  let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  const at = (a) => a.reduce((o, v, i) => (v ? (o.push(i), o) : o), []);
  return { s: btoa(s), t: at(rec.trick), g: at(rec.gift) };
}
export function unpackRec(p) {
  const s = atob(p.s), r = new Recording();
  const t = new Set(p.t || []), g = new Set(p.g || []);
  for (let i = 0; i < s.length; i++) r.push((s.charCodeAt(i) - 128) / 200, t.has(i), g.has(i));
  return r;
}
