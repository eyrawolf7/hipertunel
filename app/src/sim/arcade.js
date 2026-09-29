// Modo Arcade: las reglas de Boost 2 (choques, impulsos, placas, plegados, mundos) con un ritmo
// mucho más vivo, montado ENCIMA de la simulación sin tocarla (el Clásico sigue siendo exacto y la
// paridad con C no cambia). Es el modo por defecto de "Jugar".
// - El guion de oleadas se comprime: menos cajas por oleada y 6 filas de respiro en vez de 20, así
//   se llega antes a los mundos nuevos y la dificultad no se queda plana.
// - Se empieza con un impulso: arranque rápido y el primer error no acaba la partida.
// - Nada de acampar: si te quedas en el mismo carril, la siguiente caja sale en tu carril.
// - La densidad sube poco a poco con el tiempo de partida.
// - Al aterrizar del salto entre mundos queda 1 s sin cajas (a la velocidad de ese momento): da
//   tiempo a volver de la pirueta y a leer la pista.
// - Piruetas en ese salto (input.trick: X en Switch, toque en el móvil): cada una dura 0,4 s y da
//   monedas; se encadenan. Si la acabas en los últimos 0,3 s antes de tocar suelo es "perfecta"
//   (más monedas). Si aterrizas a mitad de una, tropiezas (pierdes la racha; no mueres). No hacerla
//   no se castiga.
// - Muro de cartón: una vez por mundo (nunca antes de los 20 s) sale una fila de piedra en los 12
//   carriles con UN bloque de cartón a 4 carriles o menos del tuyo. El cartón se rompe siempre,
//   no frena ni quita el impulso y da 5 monedas; la piedra es una caja normal (con impulso la
//   atraviesas y los pierdes; sin impulso, fin). Si tu carril más cercano es el del cartón, la piedra
//   de los lados no te toca. 5 filas vacías antes y 0,5 s después para leerlo.
import { Game, R_UNITS, LANES, SHORT_H, FOLD_IN, FOLD_OUT } from './game.js';

export const TRICK_T = 0.4;      // s que dura una pirueta
const PERFECT_T = 0.3;          // s antes de aterrizar en los que acabarla es perfecta
const WALL_LEAD = 5;            // filas vacías antes del muro
const WALL_MAX_BOXES = 18;      // el muro son 12 cajas: solo si caben (tope de 32)
const COMPRESS = 0.4;           // cajas por oleada respecto al guion original
const GAP_ROWS = 6;             // filas vacías entre oleadas (20 en el original)
export const CAMP_ROWS = 22;    // filas en un carril antes de que te echen una caja encima

export class Arcade extends Game {
  constructor({ seed = 1 } = {}) {
    super({ mode: 'classic', seed });
    this.variant = 'arcade';
    for (const w of this.waves) {
      w.a0 = w.a;
      if (w.n > 0 && w.n < 1000) w.n = Math.max(6, Math.round(w.n * COMPRESS));
    }
    this.waveLeft = this.wave.n;
    this.campRows = 0; this.campLane = -1; this.camps = 0;
    this.trickT = -1; this.tricks = 0; this.tricksTotal = 0;
    this.wallWorld = -1; this.wallLead = 0; this.wallAfter = 0; this.walls = 0; this.smashes = 0;
    this.seenWorld = this.world; this.worldT = 0;
    this.initBoost();
  }

  laneOf() { return this.lane; }   // mismo cálculo que el carril del jugador (paridad con C)

  incrementWave() {
    super.incrementWave();
    this.gap = Math.min(this.gap, GAP_ROWS);
    // cuanto más dura la partida, más cajas por fila (hasta el doble a los 4 min)
    const w = this.wave;
    if (w.interval < 0) w.a = Math.min(1, w.a0 * (1 + Math.min(1, this.time / 240)));
  }

  spawnNewBoxes(row) {
    const clear = Math.ceil(Math.max(this.v, this.vTarget) * 60 / R_UNITS * 0.75);   // + el margen que ya había ≈ 1 s
    for (const g of this.gaps) if (row.k > g.to && row.k <= g.to + 1 + clear) return;
    if (this.wallAfter > 0) { this.wallAfter--; return; }
    if (this.wallLead > 0) { if (--this.wallLead === 0) this.spawnWall(row); return; }
    if (this.wallWorld !== this.world && !this.inverted && this.time >= 20 && this.time - this.worldT >= 6
      && this.fold === FOLD_IN && !this.folding && this.boxes.length <= WALL_MAX_BOXES
      && !this.gaps.some((g) => g.to + 40 > row.k)) {
      this.wallWorld = this.world; this.wallLead = WALL_LEAD;
      return;
    }
    super.spawnNewBoxes(row);
  }

  spawnWall(row) {
    const hole = ((this.lane + (this.rng.int(0, 1000) % 9) - 4) % LANES + LANES) % LANES;
    const color = this.pickColor();
    for (let l = 0; l < LANES; l++) {
      const b = { lane: l, h: SHORT_H, fixed: true, dir: 1, color, group: 0, joined: false, wall: true, carton: l === hole };
      b.id = this.nextBoxId++; b.k = row.k; b.tall = false; b.roll = 0; b.rollSpeed = 1.5; b.grow = 1; b.hit = false;
      b.bornFrame = this.frame; b.opp = -1;
      this.boxes.push(b);
      if (this.boxes.length > 32) this.boxes.shift();
    }
    this.walls++;
    this.wallAfter = Math.ceil(Math.max(this.v, this.vTarget) * 60 / R_UNITS * 0.5);
    this.event('wall', { k: row.k, lane: hole });
  }

  crash(box) { if (!this.wallCrash(box)) super.crash(box); }

  // true si el choque ya está resuelto por el muro (cartón roto, o piedra de al lado del cartón)
  wallCrash(box) {
    if (!box.wall || !this.alive || box.hit) return false;
    if (box.carton) {
      box.hit = true; this.coinsGot += 5; this.smashes++;
      this.event('smash', { id: box.id, lane: box.lane, k: box.k });
      return true;
    }
    // en el carril del cartón, la piedra de al lado no te toca
    const hole = this.boxes.find((x) => x.wall && x.carton && x.k === box.k);
    return !!hole && this.lane === hole.lane;
  }

  // los carriles del muro se encienden (viene una caja); el del cartón se queda apagado
  // (y si detrás del muro hay otra caja en ese carril, el aviso empieza pasado el muro)
  litStrips() {
    const out = super.litStrips();
    for (const [lane, list] of out) {
      const hole = this.boxes.find((b) => b.carton && !b.hit && b.lane === lane);
      const keep = [];
      for (const x of list) {
        const b = this.boxes.find((y) => y.id === x.id);
        if (b && b.carton) continue;
        if (hole && x.to > hole.k) keep.push({ ...x, from: Math.max(x.from, hole.k + 1) });
        else if (!hole || x.to < hole.k) keep.push(x);
      }
      if (keep.length) out.set(lane, keep); else out.delete(lane);
    }
    return out;
  }

  pickLocation() {
    const l = super.pickLocation();
    if (this.campRows < CAMP_ROWS) return l;
    // llevas un rato en el mismo carril: esta caja va a por ti
    this.campRows = 0; this.camps++;
    const me = this.laneOf();
    this.lastLoc = me;
    this.event('camp', { lane: me });
    return me;
  }

  // tramo de vuelo del salto entre mundos en el que está el jugador: { a, b } en filas, o null
  flight(s = this.s) {
    for (const g of this.gaps) { const a = g.from - 3, b = g.to + 1; if (s > a && s < b) return { a, b }; }
    return null;
  }
  // segundos que faltan para aterrizar (Infinity si no vuelas)
  get landIn() { const f = this.flight(); return f ? (f.b - this.s) / (this.v * 60 / R_UNITS) : Infinity; }

  step(input = {}) {
    const before = this.s;
    const startTrick = !!input.trick && this.alive && this.trickT < 0 && !!this.flight();
    const ev = super.step(input);
    if (!this.alive) return ev;
    if (this.world !== this.seenWorld) { this.seenWorld = this.world; this.worldT = this.time; }
    if (startTrick) { this.trickT = 0; this.event('trick', { n: this.tricks + 1 }); }
    else if (this.trickT >= 0) {
      this.trickT += 1 / 60;
      const f = this.flight();
      if (!f) { this.trickT = -1; this.tricks = 0; this.event('trickFail', {}); }
      else if (this.trickT >= TRICK_T - 1e-9) {
        this.trickT = -1; this.tricks++; this.tricksTotal++;
        const perfect = (f.b - this.s) / (this.v * 60 / R_UNITS) <= PERFECT_T;
        this.coinsGot += perfect ? 10 : 5;
        this.event('trickDone', { n: this.tricks, perfect });
      }
    }
    if (this.tricks && this.trickT < 0 && !this.flight()) this.tricks = 0;
    const lane = this.laneOf();
    if (lane === this.campLane) this.campRows += this.s - before;
    else { this.campLane = lane; this.campRows = 0; }
    return this.events;
  }
}
