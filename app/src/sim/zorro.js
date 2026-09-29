// Modo Zorro: el Arcade en tercera persona con SALTO. Capa encima de la simulación (como arcade.js):
// el Clásico sigue siendo Boost 2 exacto y la paridad con C no cambia.
// - Salto de duración fija (no depende de la velocidad) con parábola: se pasa por encima de las
//   cajas cortas y de las rodantes; los pilares que cruzan el túnel no se pueden saltar.
// - Búfer de entrada: si pulsas saltar poco antes de aterrizar, el salto sale al tocar el suelo.
import { Arcade } from './arcade.js';

export const JUMP_T = 0.72;         // s en el aire
export const JUMP_H = 2.9;          // m de altura máxima (una caja corta mide 2 m)
const CLEAR_H = 2.15;               // altura a la que ya no chocas con una caja corta
const BUFFER_T = 0.16;              // s de búfer antes de aterrizar

export class Zorro extends Arcade {
  constructor(opts) {
    super(opts);
    this.variant = 'arcade'; this.hero = true;
    this.airT = -1; this.jumpBuf = 0; this.jumps = 0;
  }

  get airH() { if (this.airT < 0) return 0; const t = this.airT / JUMP_T; return 4 * JUMP_H * t * (1 - t); }
  get inAir() { return this.airT >= 0; }

  // altura visual: la de los huecos entre mundos más la del salto (lo usa el dibujo)
  jumpAt(s) { return super.jumpAt(s) + (Math.abs(s - this.s) < 1.5 ? this.airH : 0); }

  step(input = {}) {
    const dt = 1 / 60;
    if (input.jump) this.jumpBuf = BUFFER_T;
    else if (this.jumpBuf > 0) this.jumpBuf -= dt;
    let jumpNow = false;
    if (this.alive && this.airT < 0 && this.jumpBuf > 0) { this.airT = 0; this.jumpBuf = 0; this.jumps++; jumpNow = true; }
    super.step(input);                 // (vacía this.events: los sucesos propios van después)
    if (jumpNow) this.event('jump', {});
    if (this.airT >= 0) {
      this.airT += dt;
      if (this.airT >= JUMP_T) { this.airT = -1; this.event('land', {}); }
    }
    return this.events;
  }

  // en el aire, las cajas cortas pasan por debajo; los pilares altos siguen chocando
  crash(box) {
    if (this.airT >= 0 && !box.tall && this.airH > CLEAR_H) { box.jumped = true; return; }
    super.crash(box);
  }
}
