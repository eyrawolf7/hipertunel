// Modo Zorro: el Arcade en tercera persona con SALTO. Capa encima de la simulación (como arcade.js):
// el Clásico sigue siendo Boost 2 exacto y la paridad con C no cambia.
// - Salto de duración fija (no depende de la velocidad) con parábola: se pasa por encima de las
//   cajas cortas y de las rodantes; los pilares que cruzan el túnel no se pueden saltar.
// - Es un recurso, no un botón para usar siempre (si no, las cajas cortas dejarían de contar):
//   hasta 2 cargas (se empieza con 1) que se recargan con monedas o encadenando roces.
// - En el aire se gira poco: saltar mal te deja sin escape.
// - Pasar justísimo por encima de una caja cuenta como un roce (lo premia la racha).
// - Búfer de entrada: si pulsas saltar poco antes de aterrizar, el salto sale al tocar el suelo.
import { Arcade } from './arcade.js';
import { LANES } from './game.js';

export const JUMP_T = 0.72;         // s en el aire
export const JUMP_H = 2.9;          // m de altura máxima (una caja corta mide 2 m)
export const MAX_CHARGES = 2;
const CLEAR_H = 2.15;               // altura a la que ya no chocas con una caja corta
const CLOSE_H = 2.55;               // por debajo de esto, pasar por encima es "al límite"
// (el giro en el aire se puede subir a 0,5 si en el móvil se siente demasiado rígido)
const BUFFER_T = 0.16;              // s de búfer antes de aterrizar
const AIR_FULL_T = 0.10;            // s de giro completo al despegar
const AIR_STEER = 0.35;             // giro que queda en el aire (subir a 0,5 si se siente rígido)
const COINS_PER_CHARGE = 10;
const NEARS_PER_CHARGE = 5;         // roces seguidos (sin chocar) para una carga

export class Zorro extends Arcade {
  constructor(opts) {
    super(opts);
    this.variant = 'arcade'; this.hero = true;
    this.airT = -1; this.jumpBuf = 0; this.jumps = 0;
    this.grazeOn = false;   // el zorro tiene sus propios roces (dan saltos, no monedas)
    this.charges = 1; this.coinAcc = 0; this.nearRun = 0; this.nearT = 0; this.coinSeen = 0;
  }

  get airH() { if (this.airT < 0) return 0; const t = this.airT / JUMP_T; return 4 * JUMP_H * t * (1 - t); }
  get inAir() { return this.airT >= 0; }

  // altura visual: la de los huecos entre mundos más la del salto (lo usa el dibujo)
  jumpAt(s) { return super.jumpAt(s) + (Math.abs(s - this.s) < 1.5 ? this.airH : 0); }

  addCharge(why) {
    if (this.charges >= MAX_CHARGES) return;
    this.charges++;
    this.event('charge', { n: this.charges, why });
  }

  step(input = {}) {
    const dt = 1 / 60, s0 = this.s;
    if (input.jump) this.jumpBuf = BUFFER_T;
    else if (this.jumpBuf > 0) this.jumpBuf -= dt;
    let jumpNow = false, noCharge = false;
    if (this.alive && this.airT < 0 && this.jumpBuf > 0) {
      // con impulso ya atraviesas las cajas: ese salto no gasta carga
      const free = this.boostOn || this.invul > 0;
      if (free || this.charges > 0) { if (!free) this.charges--; this.airT = 0; this.jumps++; jumpNow = true; }
      else if (input.jump) noCharge = true;
      this.jumpBuf = 0;
    }
    // en el aire se gira poco (tras un instante de giro completo para ajustar el despegue)
    const steer = this.airT > AIR_FULL_T ? (input.steer || 0) * AIR_STEER : input.steer;
    super.step({ ...input, steer });   // (vacía this.events: los sucesos propios van después)
    if (jumpNow) this.event('jump', { charges: this.charges });
    if (noCharge) this.event('noJump', {});
    if (this.airT >= 0) {
      this.airT += dt;
      if (this.airT >= JUMP_T) { this.airT = -1; this.event('land', {}); }
    }
    if (!this.alive) return this.events;
    // recarga por monedas
    this.coinAcc += this.coinsGot - this.coinSeen; this.coinSeen = this.coinsGot;
    while (this.coinAcc >= COINS_PER_CHARGE) { this.coinAcc -= COINS_PER_CHARGE; this.addCharge('coins'); }
    // roces (la misma regla que el aviso "¡Por los pelos!" de main.js: carril de al lado, a más
    // de 60 m/s, uno cada 0,4 s) y saltos al límite (la caja pasa justo por debajo)
    const hw = Math.PI / 6;
    if (this.nearT > 0) this.nearT -= dt;
    for (const b of this.boxes) {
      if (b.hit || b.k + 0.5 <= s0 || b.k + 0.5 > this.s) continue;
      let d = this.theta - b.lane * hw; d = Math.atan2(Math.sin(d), Math.cos(d));
      const ad = Math.abs(d);
      if (ad < hw * 0.8 && this.inAir && this.invul <= 0 && !b.tall && this.airH < CLOSE_H) { this.event('jumpClose', {}); this.bumpNear(); break; }
      if (this.nearT <= 0 && this.speedMS > 60 && ad > hw * 0.8 && ad < hw * 1.6) { this.nearT = 0.4; this.bumpNear(); break; }
    }
    return this.events;
  }

  bumpNear() { if (++this.nearRun >= NEARS_PER_CHARGE) { this.nearRun = 0; this.addCharge('near'); } }

  // en el aire, las cajas cortas pasan por debajo; los pilares altos siguen chocando
  crash(box) {
    if (this.airT >= 0 && !box.tall && this.airH > CLEAR_H) return;
    if (this.alive && this.invul <= 0 && !box.hit) this.nearRun = 0;
    super.crash(box);
  }
}
