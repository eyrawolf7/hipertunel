// Modo Arcade: las reglas de Boost 2 (choques, impulsos, placas, plegados, mundos) con un ritmo
// mucho más vivo, montado ENCIMA de la simulación sin tocarla (el Clásico sigue siendo exacto y la
// paridad con C no cambia). Es el modo por defecto de "Jugar".
// - El guion de oleadas se comprime: menos cajas por oleada y 6 filas de respiro en vez de 20, así
//   se llega antes a los mundos nuevos y la dificultad no se queda plana.
// - Se empieza con un impulso: arranque rápido y el primer error no acaba la partida.
// - Nada de acampar: si te quedas en el mismo carril, la siguiente caja sale en tu carril.
// - La densidad sube poco a poco con el tiempo de partida.
import { Game } from './game.js';

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

  step(input = {}) {
    const before = this.s;
    const ev = super.step(input);
    if (!this.alive) return ev;
    const lane = this.laneOf();
    if (lane === this.campLane) this.campRows += this.s - before;
    else { this.campLane = lane; this.campRows = 0; }
    return this.events;
  }
}
