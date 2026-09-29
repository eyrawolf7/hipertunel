// Modo Aventura: tramos cortos y fijos con mecánicas nuevas, montados ENCIMA de la simulación de
// Boost 2 sin tocarla (la partida clásica sigue siendo exacta y la paridad con C no cambia).
//
// Cada tramo tiene su semilla: el recorrido es siempre el mismo, se aprende y el fantasma de tu
// mejor intento tiene sentido. Mecánicas:
// - Tubo roto: la carretera se corta unas filas, saltas por encima y al aterrizar solo unos
//   carriles siguen enteros; caer en un hueco es como chocar (con impulso te salvas y los pierdes).
// - Losas que se desmoronan: en ciertos tramos, si te quedas en un carril, sus losas se agrietan
//   y ese carril se hunde por delante. Obliga a moverse.
// - Poderes breves: imán (coges las monedas de los carriles de al lado), monedas dobles y escudo
//   (el siguiente choque no cuenta).
// - Jefe cada 5 tramos: tramo más largo con las oleadas más duras del guion y todo a la vez.
import { Game, LANES, ROW_M, laneAngle } from './game.js';
import { makeRng } from './rng.js';

const TAU = Math.PI * 2;
const mod = (a, n) => ((a % n) + n) % n;

// wave: oleada del guion clásico con la que empieza. Oleada y semilla salen de una búsqueda con
// bots de tres niveles (novato, medio, bueno) para que la curva suba suave y los jefes sean un pico
// (ver tests/aventura.mjs)
// rows: largo del tramo en filas (4 m cada una); breaks / crumble: cuántos de cada
export const STAGES = [
  { name: 'La primera grieta', seed: 1101, wave: 0, rows: 420, breaks: 2, crumble: 0, powers: 1, world: 0, tip: 'El tubo se rompe: ponte en un carril entero antes del salto' },
  { name: 'Suelo que cruje', seed: 1102, wave: 0, rows: 460, breaks: 1, crumble: 1, zone: 50, powers: 1, world: 0, tip: 'Donde el suelo cruje, no te quedes quieto en un carril' },
  { name: 'Luces del camino', seed: 1103, wave: 1, rows: 480, breaks: 2, crumble: 1, powers: 2, world: 1 },
  { name: 'Saltos en la selva', seed: 1304, wave: 7, rows: 520, breaks: 3, crumble: 1, powers: 2, world: 1, tip: 'Las cajas rodantes cambian de carril: mira hacia dónde giran' },
  { name: 'Jefe: el Guardián', seed: 1405, wave: 8, rows: 680, breaks: 3, crumble: 2, powers: 2, world: 1, boss: true },
  { name: 'Cascada rota', seed: 1306, wave: 10, rows: 540, breaks: 2, crumble: 2, powers: 2, world: 2 },
  { name: 'Noche sin suelo', seed: 1407, wave: 9, rows: 560, breaks: 3, crumble: 2, powers: 2, world: 2 },
  { name: 'Luciérnagas', seed: 1308, wave: 13, rows: 580, breaks: 3, crumble: 2, powers: 2, world: 2 },
  { name: 'Escalinata', seed: 1309, wave: 18, rows: 600, breaks: 3, crumble: 3, powers: 2, world: 3 },
  { name: 'Templo en ruinas', seed: 1310, wave: 14, rows: 620, breaks: 4, crumble: 3, powers: 3, world: 3 },
  { name: 'Puente de lava', seed: 1211, wave: 17, rows: 640, breaks: 4, crumble: 3, powers: 3, world: 4 },
  { name: 'Jefe: el Volcán', seed: 1112, wave: 21, rows: 780, breaks: 4, crumble: 3, powers: 3, world: 4, boss: true },
];

export const COIN_STAR = 0.35;  // parte de las monedas del tramo para la estrella de monedas
const BREAK_ROWS = 6;          // filas sin carretera
const LAND_ROWS = 3;           // filas de aterrizaje con huecos
const CRUMBLE_ROWS = 70;       // largo de una zona que se desmorona (por defecto)
// filas seguidas en un carril antes de que se hunda: en filas y no en segundos, para que ir lento
// tras un choque no lo vuelva más difícil
const WEAR_ROWS = 12;
const POWER_S = { magnet: 8, x2: 10 };
export const POWERS = ['magnet', 'x2', 'shield'];

export class Adventure extends Game {
  constructor({ stage = 0 } = {}) {
    const st = STAGES[stage];
    super({ mode: 'classic', seed: st.seed });
    this.stageIdx = stage;
    this.stage = st;
    this.mode = 'adventure';
    // el tramo empieza en su oleada del guion
    if (st.wave > 0) { this.waveIdx = st.wave; this.wave = this.waves[st.wave]; this.waveLeft = this.wave.n; this.gap = 20; }
    // en Aventura se empieza con un impulso: el primer error no acaba el tramo
    this.initBoost();
    this.advRng = makeRng((st.seed * 2654435761) >>> 0);
    this.holes = new Map();      // k -> Set de carriles hundidos
    this.safe = new Map();       // k -> filas protegidas (sin cajas): huecos y aterrizajes
    this.zones = [];             // { from, to, wear: [12], gone: Set }
    this.pickups = [];           // { k, lane, kind, got }
    this.power = null; this.powerT = 0; this.shield = false;
    this.coinsSpawned = 0;
    this.cleared = false;
    this.falls = 0;
    this.plan();
  }

  // reparte roturas, zonas que se desmoronan y poderes a lo largo del tramo, sin solaparse
  plan() {
    const st = this.stage, r = this.advRng, L = st.rows;
    const slots = [];
    const put = (kind, len) => {
      for (let t = 0; t < 40; t++) {
        const a = Math.floor(60 + r.float(0, 1) * (L - 60 - len - 20));
        if (slots.every((s) => a + len + 25 < s.a || a > s.b + 25)) { slots.push({ kind, a, b: a + len }); return; }
      }
    };
    for (let i = 0; i < st.crumble; i++) put('crumble', st.zone || CRUMBLE_ROWS);
    for (let i = 0; i < st.breaks; i++) put('break', BREAK_ROWS + LAND_ROWS);
    for (const s of slots) {
      if (s.kind === 'crumble') this.zones.push({ from: s.a, to: s.b, wear: new Array(LANES).fill(0), gone: new Set(), warned: false, creak: new Array(LANES).fill(0) });
      else {
        const from = s.a, to = s.a + BREAK_ROWS - 1;
        this.gaps.push({ from, to, adv: true });
        // al aterrizar solo sigue entero un arco de 4-6 carriles
        const n = 4 + Math.floor(r.float(0, 1) * 3), c0 = Math.floor(r.float(0, 1) * LANES);
        const ok = new Set(); for (let j = 0; j < n; j++) ok.add(mod(c0 + j, LANES));
        // los carriles que no aguantan ya faltan antes de la rotura (desde 10 filas antes, cada vez
        // más): se ve venir y da tiempo a ponerse en uno entero
        for (let k = from - 10; k < from; k++) {
          const h = new Set(); const reach = Math.ceil((LANES - n) * (k - (from - 10) + 1) / 10);
          const bad = []; for (let j = 0; j < LANES - n; j++) bad.push(mod(c0 + n + j, LANES));
          // se hunden primero los del centro del arco malo y luego hacia los bordes
          bad.sort((x, y) => Math.abs(mod(x - c0 - n, LANES) - (LANES - n) / 2) - Math.abs(mod(y - c0 - n, LANES) - (LANES - n) / 2));
          for (let j = 0; j < reach; j++) h.add(bad[j]);
          this.holes.set(k, h);
        }
        for (let k = to + 1; k <= to + LAND_ROWS; k++) { const h = new Set(); for (let l = 0; l < LANES; l++) if (!ok.has(l)) h.add(l); this.holes.set(k, h); }
        for (let k = from - 14; k <= to + LAND_ROWS + 4; k++) this.safe.set(k, true);
      }
    }
    this.gaps.sort((a, b) => a.from - b.from);
    // sin cajas dentro de las zonas que crujen: ahí la única amenaza es el suelo
    for (const z of this.zones) for (let k = z.from - 6; k <= z.to; k++) this.safe.set(k, true);
    // jefes: punto de control a mitad del tramo
    this.checkpointRow = st.boss ? Math.floor(L / 2) : -1;
    this.pastCheckpoint = false;
    // poderes, en filas libres
    for (let i = 0; i < st.powers; i++) {
      let k = 0; for (let t = 0; t < 30; t++) { k = Math.floor(80 + r.float(0, 1) * (L - 120)); if (!this.safe.get(k)) break; }
      this.pickups.push({ k, lane: Math.floor(r.float(0, 1) * LANES), kind: POWERS[Math.floor(r.float(0, 1) * POWERS.length)], got: false });
    }
  }

  // el salto por encima de una rotura es bajo (1,6): en el tubo, el de 5,5 del salto entre mundos
  // sacaba la cámara del túnel
  jumpAt(s) {
    for (const g of this.gaps) {
      const a = g.from - 3, b = g.to + 1;
      if (s > a && s < b) { const t = (s - a) / (b - a); return 4 * (g.adv ? 1.6 : 5.5) * t * (1 - t); }
    }
    return 0;
  }

  isHole(k, lane) { const h = this.holes.get(k); return !!(h && h.has(lane)); }
  // desgaste 0..1 de un carril en la fila k (para las grietas del dibujo)
  wearAt(k, lane) { for (const z of this.zones) if (k >= z.from && k <= z.to) return z.gone.has(lane) ? 1 : Math.min(1, z.wear[lane] / WEAR_ROWS); return 0; }
  get progress() { return Math.min(1, this.s / this.stage.rows); }

  // sin cajas en las roturas ni en los aterrizajes (no se puede esquivar lo que no se ve al saltar)
  updateBoxes(row) { if (this.safe.get(row.k) === true) return; super.updateBoxes(row); }
  spawnCoins(row) { const n = this.coins.length; super.spawnCoins(row); for (let i = n; i < this.coins.length; i++) if (this.coins[i].k <= this.stage.rows) this.coinsSpawned++; }

  crash(box) {
    if (this.shield && this.invul <= 0 && !box.hit && this.alive) {
      // escudo: se gasta y atraviesas sin perder impulsos
      this.shield = false; box.hit = true; this.invul = 1.0;
      this.event('shield', {});
      return;
    }
    super.crash(box);
  }

  // hundirse en un hueco cuenta como choque (con impulso te salvas y los pierdes)
  fall() {
    this.falls++;
    this.event('fall', {});
    this.crash({ id: -1000 - this.falls, hit: false, lane: this.lane, k: Math.floor(this.s), fixed: true });
  }

  laneOf() { return mod(Math.round(this.theta / (Math.PI / 6)), LANES); }

  step(input = {}) {
    const ev = super.step(input);
    if (!this.alive) return ev;
    const dt = 1 / 60, cur = Math.floor(this.s), lane = this.laneOf();
    // ---- final del tramo
    if (this.s >= this.stage.rows) { this.cleared = true; this.alive = false; this.event('clear', {}); return this.events; }
    // ---- punto de control (jefes)
    if (!this.pastCheckpoint && this.checkpointRow > 0 && cur >= this.checkpointRow) { this.pastCheckpoint = true; this.event('checkpoint', { frame: this.frame }); }
    // ---- huecos: si pisas uno (y no vas por el aire)
    if (this.invul <= 0 && this.jumpAt(this.s) < 0.25 && this.isHole(cur, lane)) this.fall();
    // ---- zonas que se desmoronan
    const dRows = this.v / 13.176;             // filas avanzadas en este paso
    for (const z of this.zones) {
      if (!z.warned && cur >= z.from - 18 && cur < z.from) { z.warned = true; this.event('zoneIn', {}); }
      if (cur < z.from || cur > z.to) continue;
      for (let l = 0; l < LANES; l++) if (l !== lane && !z.gone.has(l)) z.wear[l] = Math.max(0, z.wear[l] - dRows * 0.5);
      if (z.gone.has(lane)) continue;
      z.wear[lane] += dRows;
      const f = z.wear[lane] / WEAR_ROWS;
      if (f > 0.35 && z.creak[lane] < 1) { z.creak[lane] = 1; this.event('creak', { k: 0.4, lane }); }
      if (f > 0.7 && z.creak[lane] < 2) { z.creak[lane] = 2; this.event('creak', { k: 0.9, lane }); }
      if (z.wear[lane] >= WEAR_ROWS) {
        z.creak[lane] = 0;
        // el carril se hunde desde un poco por delante hasta el final de la zona
        z.gone.add(lane);
        const ahead = Math.max(3, Math.ceil(0.45 * 60 * this.v / 13.176));
        for (let k = cur + ahead; k <= z.to; k++) { if (!this.holes.has(k)) this.holes.set(k, new Set()); this.holes.get(k).add(lane); }
        this.event('crumble', { lane, k: cur + ahead });
        z.wear[lane] = WEAR_ROWS;
      }
    }
    // ---- poderes
    if (this.powerT > 0 && (this.powerT -= dt) <= 0) { this.event('powerEnd', { kind: this.power }); this.power = null; }
    for (const p of this.pickups) {
      if (p.got) continue;
      const d = this.s - (p.k - 0.5);
      if (d < -0.55 || d > 0.45) continue;
      let da = laneAngle(p.lane) - this.theta; da = Math.atan2(Math.sin(da), Math.cos(da));
      if (Math.abs(da) > 0.33) continue;
      p.got = true;
      if (p.kind === 'shield') this.shield = true;
      else { this.power = p.kind; this.powerT = POWER_S[p.kind]; }
      this.event('power', { kind: p.kind });
    }
    return this.events;
  }

  // imán: también las monedas de los carriles de al lado; x2: cada moneda cuenta doble
  checkCoins() {
    if (this.power === 'magnet') {
      for (const c of this.coins) {
        if (c.got) continue;
        const d = this.s - (c.k - 0.5);
        if (d < -0.55 || d > 0.45) continue;
        let da = laneAngle(c.lane) - this.theta; da = Math.atan2(Math.sin(da), Math.cos(da));
        if (Math.abs(da) < 0.33 || Math.abs(da) > 1.2) continue;
        c.got = true; this.coinsGot++;
        this.event('coin', { combo: 0, lane: c.lane, k: c.k, magnet: true });
      }
    }
    const before = this.coinsGot;
    super.checkCoins();
    if (this.power === 'x2') this.coinsGot += this.coinsGot - before;
  }

  prune() {
    super.prune();
    const k0 = Math.floor(this.s) - 3;
    for (const k of this.holes.keys()) if (k < k0) this.holes.delete(k);
  }

  // cada estrella es independiente (bits): 1 = superado, 2 = sin chocar ni caer, 4 = monedas
  get starBits() {
    if (!this.cleared) return 0;
    let b = 1;
    if (this.crashes === 0 && this.falls === 0 && !this.fromCheckpoint) b |= 2;
    if (this.coinsGot >= this.coinGoal) b |= 4;
    return b;
  }
  get coinGoal() { return Math.ceil(this.coinsSpawned * COIN_STAR); }
  get stars() { const b = this.starBits; return (b & 1) + ((b >> 1) & 1) + ((b >> 2) & 1); }
}

// fantasma: los giros de cada fotograma, cuantizados a un byte y en base64 (unos 3-6 KB por tramo)
export function packGhost(steers) {
  const b = new Uint8Array(steers.length);
  for (let i = 0; i < steers.length; i++) b[i] = Math.max(0, Math.min(255, Math.round(steers[i] * 200) + 128));
  let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
}
export function unpackGhost(str) {
  const s = atob(str); const out = new Float64Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = (s.charCodeAt(i) - 128) / 200;
  return out;
}
// el giro que se juega se cuantiza igual que el que se guarda: así el fantasma repite la partida
export const quantSteer = (a) => (Math.max(0, Math.min(255, Math.round(a * 200) + 128)) - 128) / 200;
