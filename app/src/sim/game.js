// Simulación de Hipertúnel: réplica fiel de la jugabilidad de Boost 2.
//
// Reglas del módulo (para poder portarlo a C/C++ en Android o Switch sin tocar el diseño):
// - Nada de DOM, ni Three.js, ni reloj del sistema. Solo números.
// - Paso fijo: step() avanza exactamente un fotograma de 60 Hz, como el original (que mide todo
//   en fotogramas). Quien lo llame se encarga del acumulador de tiempo.
// - Aleatoriedad solo con el rng sembrado: misma semilla + mismas entradas = misma partida.
//
// Unidades internas: las del original (radio y largo de fila = 13,176). La escala al mundo en
// metros la aplica quien dibuja (M_PER_UNIT).

import { makeRng } from './rng.js';
import { buildWaves } from './waves.js';

export const LANES = 12;
export const CELL_DEG = 30;                  // Tunnel::STANDARD_ANGLE_INC
export const R_UNITS = 13.176254;            // radio del tubo cerrado y largo de una fila
export const ROWS = 30;                      // filas vivas en el anillo
export const M_PER_UNIT = 4 / R_UNITS;       // radio 4 m en nuestro mundo
export const ROW_M = 4;                      // una fila en metros
export const SHORT_H = 6.5881267;            // altura de caja corta (media R)
const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

export const FOLD_IN = 30, FOLD_OUT = -30;   // grados por celda: tubo cerrado / por fuera

// velocidad, en unidades por fotograma
export const V_START = 2.0, V_MAX = 5.5;
const V_EPS = 0.001, V_UP = 0.025, V_DOWN = 0.1;
const BOOST_TOWARD = 7.0, BOOST_K = 0.33;
const INVUL_S = 1.5;

// giro: rad por fotograma por unidad de inclinación, y zona muerta
export const STEER_GAIN = 0.2, STEER_DEAD = 0.019;

const wrapAngle = (a) => { a %= TAU; return a < 0 ? a + TAU : a; };
export const laneAngle = (l) => l * CELL_DEG * DEG;
const mod = (a, n) => ((a % n) + n) % n;

export function stripHalfWidth(fold) {        // Physics::isPlayerOnStrip / Box::collisionCheck
  return (22.5 - (1 - (CELL_DEG + fold) / 60) * 7.5) * DEG;
}

function angleIn(theta, lo, hi) {             // intervalo angular con vuelta, como el original
  if (hi > lo) return theta > lo && theta < hi;
  return theta > lo || theta < hi;
}

export class Game {
  constructor({ mode = 'classic', seed = 1 } = {}) {
    this.mode = mode;
    this.seed = seed >>> 0;
    this.rng = makeRng(this.seed);
    this.reset();
  }

  reset() {
    const rng = this.rng;
    this.frame = 0;
    this.time = 0;                     // segundos de partida
    this.events = [];                  // sucesos del último paso, para sonido y efectos

    // ---- túnel
    this.fold = FOLD_IN;
    this.folding = false;              // hay un plegado en curso (Tunnel+0x3b4c8)
    this.foldToIn = false;             // sentido del plegado en curso
    this.foldRows = 0;                 // filas desde que se ordenó
    this.foldStarted = false;
    this.world = this.mode === 'survival' ? 2 : 0;   // estado visual: pares = mundo, impares = transición invertida
    this.worldRows = -1;               // cuenta atrás hasta salir del estado invertido
    this.curves = true;
    this.turn = { yawT: 0, pitchT: 0, dYaw: 0, dPitch: 0, thr: 2, need: true };
    this.rows = [];                    // filas vivas, rows[i].k es su índice absoluto
    this.kFirst = 0;

    // ---- jugador
    this.s = 0;                        // posición a lo largo del túnel, en filas (Player::init: frac 0)
    this.theta = 0;                    // ángulo alrededor del túnel (rad)
    this.omega = 0;
    this.v = V_START; this.vTarget = V_START;
    this.level = 0;                    // impulsos (0..3)
    this.boostOn = false;
    this.invul = 0;
    this.alive = true;
    this.crashes = 0;
    this.rowsPassed = 0;
    this.maxBoostTime = 0; this.boostTime = 0;   // racha más larga a tope
    this.boostTotal = 0;               // Player+0x128: tiempo total a tope (lo que enseña el clásico)
    this.timeLeft = 60;                // contrarreloj
    this.lastCollideRow = -99;

    // ---- cajas y placas
    this.boxes = [];
    this.nextBoxId = 1;
    this.waves = buildWaves(this.mode, rng);
    this.waveIdx = 0;
    this.wave = this.waves[0];
    this.waveLeft = this.wave.n;
    this.gap = 0;                      // filas vacías entre oleadas
    this.coll = null;                  // colección en curso
    this.intervalCount = 0;
    this.lastLoc = rng.int(0, 100000) % LANES;
    this.invertedHold = false;
    this.boostCounter = 0;             // BoostManager+8 (25 solo en el tutorial)
    this.pads = [];                    // { k, lane, taken }

    // ---- monedas (añadido de Hipertúnel, no está en Boost 2). Llevan su propio generador para
    // no alterar la secuencia de cajas y placas del original.
    this.coinRng = makeRng((this.seed ^ 0x9e3779b9) >>> 0);
    this.coins = [];                   // { k, lane, got }
    this.coinRun = null;
    this.coinsGot = 0;
    this.gaps = [];                    // tramos sin carretera (salto entre mundos), solo visual
    this.coinStreak = 0; this.coinStreakT = 0;

    for (let i = 0; i < ROWS; i++) this.pushRow(true);
    // BoxManager+0x70 empieza desfasado del contador del túnel: hay una pasada de cajas en el
    // primer fotograma
    this.pendingRow = true;
  }

  // ------------------------------------------------------------------ túnel
  pushRow(initial) {
    const prev = this.rows[this.rows.length - 1];
    const k = prev ? prev.k + 1 : 0;
    let yaw = 0, pitch = 0;
    if (prev) {
      const t = this.turn;
      if (t.need && !this.folding) this.nextTurn(prev);
      yaw = prev.yaw - t.dYaw;
      pitch = prev.pitch + t.dPitch;
      // Tunnel::updateAngle: llegar al objetivo solo apaga la marca de ese eje; el paso sigue
      // aplicándose hasta que llegan los dos y se elige un objetivo nuevo
      if (Math.abs(yaw - t.yawT) < t.thr) t.yawOn = false;
      if (Math.abs(pitch - t.pitchT) < t.thr) t.pitchOn = false;
      if (!t.yawOn && !t.pitchOn) t.need = true;
      if (this.folding) {
        if (this.foldRows === 0) { t.dYaw = t.dPitch = 0; t.yawOn = t.pitchOn = false; }
        this.foldRows++;
      }
    }
    const row = { k, yaw, pitch, taken: false };
    this.rows.push(row);
    if (this.rows.length > ROWS) this.rows.shift();
    this.kFirst = this.rows[0].k;
    if (!initial) this.onNewRow(row);
    return row;
  }

  nextTurn(prev) {                     // Tunnel::calculateNextAngle
    const t = this.turn, rng = this.rng;
    t.yawT = rng.float(-45, 45);
    t.pitchT = rng.float(-45, 45);
    rng.float(0.5, 2);                 // tirada que el original descarta
    const r = rng.float(0.5, 3.5);
    let k = 1 - (this.vTarget - 2) / 5.5;
    k = k > 1 ? 1 : k < 0 ? 0 : k;
    let step = 0;
    if (this.curves) step = r * k;
    t.thr = 2 + step;
    t.dYaw = t.yawT - prev.yaw > 0 ? -step : step;
    t.dPitch = t.pitchT - prev.pitch > 0 ? step : -step;
    t.yawOn = step !== 0; t.pitchOn = step !== 0;
    t.need = false;
  }

  rowAt(k) { const i = k - this.kFirst; return i >= 0 && i < this.rows.length ? this.rows[i] : null; }
  get kLast() { return this.rows[this.rows.length - 1].k; }

  // ------------------------------------------------------------------ fila nueva
  onNewRow(row) {
    // estado visual: tras un plegado se pasa a un estado invertido 24 filas y luego al mundo nuevo
    if (this.worldRows > 0 && --this.worldRows === 0) {
      this.world = Math.min(6, this.world + 1);
      this.event('world', { world: this.world });
    }
    // Tunnel::addGrid solo decide placas; las cajas de esta fila las pone BoxManager::update en el
    // fotograma siguiente, después del plegado (orden de Game::update del original)
    this.spawnBoosts(row);
    this.pendingRow = true;
  }

  // Monedas: tiras de 5 a 10 por un carril libre, a veces en curva para obligar a girar. En el
  // estado invertido (sin cajas) sale una lluvia de tiras: es el premio de cambiar de mundo.
  spawnCoins(row) {
    const rng = this.coinRng;
    const free = (l) => !this.boxes.some((b) => (b.lane === l || b.opp === l) && b.k >= row.k - 2 && b.k <= row.k + 1)
      && !this.pads.some((p) => p.lane === l && Math.abs(p.k - row.k) < 2);
    let run = this.coinRun;
    if (!run) {
      const p = this.inverted ? 0.35 : this.folding ? 0.05 : 0.045;
      if (rng.next() > p) return;
      run = this.coinRun = { lane: Math.trunc(rng.float(0, LANES)), left: Math.trunc(rng.float(5, 11)), curve: rng.next() < 0.35 ? (rng.next() < 0.5 ? 1 : -1) : 0, step: 0 };
    }
    if (run.curve && ++run.step % 2 === 0) run.lane = mod(run.lane + run.curve, LANES);
    if (this.fold !== FOLD_IN && this.fold !== FOLD_OUT) run.lane = Math.max(0, Math.min(LANES - 1, run.lane));
    if (free(run.lane)) this.coins.push({ k: row.k, lane: run.lane, got: false });
    if (--run.left <= 0) this.coinRun = null;
  }

  checkCoins() {
    const hw = 0.33;
    for (const c of this.coins) {
      if (c.got) continue;
      const d = this.s - (c.k - 0.5);
      if (d < -0.55 || d > 0.45) continue;
      const a = laneAngle(c.lane);
      const open = this.fold !== FOLD_IN && this.fold !== FOLD_OUT;
      const ok = open ? Math.abs(this.theta - a) < hw : angleIn(wrapAngle(this.theta), wrapAngle(a - hw), wrapAngle(a + hw));
      if (!ok) continue;
      c.got = true;
      this.coinsGot++;
      this.coinStreak = this.coinStreakT > 0 ? this.coinStreak + 1 : 0;
      this.coinStreakT = 0.6;
      this.event('coin', { combo: this.coinStreak, lane: c.lane, k: c.k });
    }
    if (this.coinStreakT > 0) this.coinStreakT -= 1 / 60;
  }

  // ------------------------------------------------------------------ oleadas y cajas
  incrementWave() {
    if (this.waveIdx + 1 >= this.waves.length) return;
    this.waveIdx++;
    this.wave = this.waves[this.waveIdx];
    this.waveLeft = this.wave.n;
    this.coll = null;
    this.gap = 20;
    this.curves = this.wave.curves;
    if (this.wave.world !== undefined) { this.world = this.wave.world; this.event('world', { world: this.world }); }
    if (this.wave.fold) this.beginFold();
    this.event('wave', { wave: this.waveIdx });
  }

  get inverted() { return this.world === 1 || this.world === 3 || this.world === 5; }

  updateBoxes(row) {
    // BoxManager::update: primero updateWave; en clásico y contrarreloj no sale nada mientras
    // dura el estado invertido, ni en la primera fila después
    if (this.wave.n >= 0 && this.waveLeft < 1 && !this.coll) this.incrementWave();
    if (this.mode === 'classic' || this.mode === 'timetrial') {
      if (!this.inverted) { if (!this.invertedHold) this.spawnNewBoxes(row); }
      else if (!this.invertedHold) {
        this.invertedHold = true;
        if (this.fold > 0 && this.wave.fold) { this.coll = null; this.waveLeft = 0; this.incrementWave(); }
      }
      if (!this.inverted) this.invertedHold = false;
      return;
    }
    this.spawnNewBoxes(row);
  }

  spawnNewBoxes(row) {
    const w = this.wave, rng = this.rng;
    if (--this.gap >= 1) return;
    this.gap = 0;
    if (!this.coll) {
      let go;
      if (w.interval < 0) go = rng.prob(w.a);
      else if (this.intervalCount < w.interval) { this.intervalCount++; go = false; }
      else { this.intervalCount = 0; go = true; }
      if (!go) return;
      if (rng.prob(w.e)) this.startCollection();
      else this.spawnBox(row, null);
      return;
    }
    const c = this.coll;
    if (c.left < 1) { this.coll = null; return; }
    if (--c.sepCount < 0) {
      c.sepCount = w.sep;
      c.left--;
      this.spawnBox(row, c);
    }
    if (w.period < 0) {
      for (let i = w.period; i < 1; i++) this.spiralStep(c);
    } else if (--c.periodCount < 1) {
      c.periodCount = w.period;
      this.spiralStep(c);
    }
  }

  spiralStep(c) {
    if (!c.spiral) return;
    c.lane += c.spin;
    if (c.lane > LANES - 1) c.lane = 0;
    else if (c.lane < 0) c.lane = LANES - 1;
  }

  pickLocation() {                    // BoxManager::pickRandomLocation
    const rng = this.rng;
    let l = rng.int(0, 100000) % LANES;
    if (l === this.lastLoc) { l = Math.trunc(l + rng.float(2, 6)); if (l > LANES - 1) l -= LANES; }
    this.lastLoc = l;
    return l;
  }

  pickHeight() { return this.rng.prob(this.wave.c) ? R_UNITS : SHORT_H; }

  startCollection() {
    const w = this.wave, rng = this.rng;
    if (!(this.waveLeft > 0 || w.n < 0)) return;
    const c = { count: 0, sepCount: w.sep, periodCount: w.period };
    c.color = this.pickColor();
    c.lane = this.pickLocation();
    c.h = this.pickHeight();
    c.fixed = rng.prob(w.b);
    c.rollDir = Math.trunc(rng.float(0, 2)) === 0 ? 1 : -1;
    c.spin = Math.trunc(rng.float(0, 2)) === 0 ? 1 : -1;
    if (!c.fixed) c.h = SHORT_H;
    c.spiral = rng.prob(w.d);
    if (c.spiral && !c.fixed && !w.spiralRollers) c.spiral = false;
    c.left = Math.trunc(rng.float(w.nMin, w.nMax));
    if (c.h === R_UNITS && c.spiral && c.left > 5 && w.sep === 0 && w.period === 1) c.left = 5;
    c.id = this.nextBoxId;             // identifica las piezas de una misma barra
    this.coll = c;
  }

  pickColor() { return this.rng.int(0, 1000) % 10; }   // 10 colores del original

  spawnBox(row, c) {
    const w = this.wave, rng = this.rng;
    let b;
    if (!c) {
      const lane = this.pickLocation();
      let h = this.pickHeight();
      const fixed = rng.prob(w.b);
      const dir = rng.prob(w.dir) ? 1 : -1;
      if (!fixed) h = SHORT_H;
      b = { lane, h, fixed, dir, color: this.pickColor(), group: 0, joined: false };
    } else {
      b = { lane: c.lane, h: c.h, fixed: c.fixed, dir: c.rollDir, color: c.color, group: c.id, joined: false };
      if (w.variant > 0 && c.count % w.variant === 0) { b.fixed = true; b.h = R_UNITS; }
      c.count++;
      // las fijas seguidas de una colección recta se dibujan como una sola barra larga
      if (b.fixed && !c.spiral && c.count > 1) b.joined = true;
    }
    b.id = this.nextBoxId++;
    b.k = row.k;
    b.tall = b.h > R_UNITS - 1;
    b.roll = 0;                         // grados girados hacia el carril siguiente
    b.rollSpeed = 1.5 * b.dir;          // grados por fotograma
    b.grow = this.fold === FOLD_OUT && !this.folding ? 0 : 1;
    b.hit = false;
    b.bornFrame = this.frame;
    if (this.folding && (this.fold > 25 || this.foldToIn)) { b.h = SHORT_H; b.tall = false; }
    if (!b.fixed && this.fold !== FOLD_IN && this.fold !== FOLD_OUT && ((b.lane === LANES - 1 && b.rollSpeed > 0) || (b.lane === 0 && b.rollSpeed < 0))) b.rollSpeed = -b.rollSpeed;
    // en el tubo cerrado el pilar alto cruza de lado a lado y tapa también el carril opuesto
    b.opp = b.tall && this.fold === FOLD_IN ? mod(b.lane + LANES / 2, LANES) : -1;
    this.boxes.push(b);
    if (this.boxes.length > 32) this.boxes.shift();
    if (w.n >= 0 && (this.fold === FOLD_IN || this.fold === FOLD_OUT)) this.waveLeft--;
    this.event('spawn', { id: b.id });
  }

  // ------------------------------------------------------------------ placas
  spawnBoosts(row) {
    const m = this.mode;
    if (m === 'survival') return;
    if ((m === 'classic' || m === 'timetrial') && !(this.level < 3 && this.wave.boosts)) return;
    const rng = this.rng;
    const r = rng.float(0, 90);
    const c = this.boostCounter++;
    if (!(119 - c < Math.trunc(r) && c + 1 > 20)) return;
    const k = row.k - 6;
    const lane = rng.int(0, 100000) % LANES;
    const closed = this.fold > 0;
    const lanes = closed ? [lane, (lane + 6) % LANES] : [lane, (lane + 3) % LANES, (lane + 6) % LANES, (lane + 9) % LANES];
    // la celda 'ocupada' del original solo la marcan las franjas iluminadas (cajas fijas)
    // filas del anillo padRow−6 … padRow+11 (con vuelta: también las 5 más antiguas)
    const kl = this.kLast;
    const busy = (l) => this.boxes.some((b) => b.fixed && !b.hit && (b.lane === l || b.opp === l) && ((b.k >= k - 6 && b.k <= k + 6) || (b.k >= kl - 29 && b.k <= kl - 25)));
    let ok;
    if (closed) {
      if (lanes.some(busy)) return;
      ok = lanes;
      this.boostCounter = -Math.trunc(rng.float(0, 10));
    } else {
      ok = lanes.filter((l) => !busy(l));
      this.boostCounter = Math.trunc(rng.float(0, 10));
    }
    for (const l of ok) this.pads.push({ k, lane: l, taken: false });
  }

  // ------------------------------------------------------------------ plegado
  beginFold() {
    if (this.folding) return;
    this.folding = true;
    this.foldToIn = this.fold <= 25;
    this.foldRows = 0;
    this.foldStarted = false;
    this.event('foldOrder', {});
  }

  updateFold() {                       // Tunnel::updateFold, simplificado a su ritmo real
    if (!this.folding || !this.alive) return;
    if (this.foldRows < 32) return;    // antes, 32 filas de recta
    if (!this.foldStarted) { this.foldStarted = true; this.event('foldStart', { toIn: this.foldToIn }); }
    const rate = Math.min(Math.abs(this.fold) / 150 + 0.05, 0.1);
    const target = this.foldToIn ? FOLD_IN : FOLD_OUT;
    const dir = Math.sign(target - this.fold);
    // primero se encoge hacia 0; al quedar por debajo del paso cambia de signo y luego crece
    if (this.fold * target <= 0 && Math.abs(this.fold) < rate) this.fold = -this.fold;
    else this.fold += dir * rate;
    if ((dir > 0 && this.fold >= target) || (dir < 0 && this.fold <= target)) {
      this.fold = target;
      this.folding = false;
      // Tunnel::switchStateWithTransition: estado invertido 24 filas y después el mundo nuevo
      // switchStateWithTransition solo al volver a plegar hacia dentro (clásico y contrarreloj)
      if (this.foldToIn && (this.mode === 'classic' || this.mode === 'timetrial')) {
        this.world = Math.min(6, this.world + 1);
        this.worldRows = 24;
      }
      // En el estado invertido no sale ninguna caja: el render aprovecha ese hueco para cortar la
      // carretera y hacer un salto entre mundos. Es solo visual, no cambia ninguna regla.
      if (this.inverted) this.gaps.push({ from: this.kLast + 4, to: this.kLast + 19 });
      this.event('foldEnd', { toIn: this.foldToIn, world: this.world });
    }
  }

  // ------------------------------------------------------------------ jugador
  steer(a) {                           // Player::updateRotation
    this.omega = Math.abs(a) < STEER_DEAD ? 0 : a * STEER_GAIN;
    this.theta += this.omega;
    const openSheet = this.fold !== FOLD_IN && this.fold !== FOLD_OUT;
    if (!openSheet) this.theta = wrapAngle(this.theta);
    else {
      if (this.theta > 5.9) this.theta = 5.9;
      if (this.theta < -0.1) this.theta = -0.1;
    }
  }

  onStrip(lane) {
    const hw = stripHalfWidth(this.fold);
    let lo = laneAngle(lane) - hw, hi = laneAngle(lane) + hw;
    if (this.fold !== FOLD_IN && this.fold !== FOLD_OUT) return this.theta > lo && this.theta < hi;
    lo = wrapAngle(lo); hi = wrapAngle(hi);
    return angleIn(wrapAngle(this.theta), lo, hi);
  }

  get lane() { return mod(Math.round(this.theta / (CELL_DEG * DEG)), LANES); }

  initBoost() {
    this.level = Math.min(3, this.level + 1);
    let t = this.vTarget + (BOOST_TOWARD - this.vTarget) * BOOST_K;
    if (t >= V_MAX || this.level === 3) t = V_MAX;
    this.vTarget = t;
    this.v = t;
    this.boostOn = true;
    if (this.mode === 'timetrial') this.timeLeft += this.level * 3.5;
    this.event('boost', { level: this.level });
  }

  disableBoost() {
    if (this.boostTime > this.maxBoostTime) this.maxBoostTime = this.boostTime;
    this.boostTime = 0;
    this.vTarget = V_START;
    this.boostOn = false;
    this.level = 0;
  }

  crash(box) {                         // Box::collide + GameManager::collide
    if (this.invul > 0 || box.hit || !this.alive) return;
    box.hit = true;
    this.v = 1.0;
    this.event('crash', { id: box.id, lane: box.lane, k: box.k, fatal: !this.boostOn || this.mode === 'survival' });
    if (!this.boostOn || this.mode === 'survival') { this.die(box); return; }
    this.invul = INVUL_S;
    this.disableBoost();
    if (this.mode === 'timetrial') this.timeLeft += Math.max(-5 - this.crashes, -15);
    this.crashes++;
  }

  die(box) {
    this.alive = false;
    this.killer = box ? box.id : 0;
    if (this.boostTime > this.maxBoostTime) this.maxBoostTime = this.boostTime;
    this.event('death', { id: box ? box.id : 0 });
  }

  // ------------------------------------------------------------------ paso de 1 fotograma
  step(input = {}) {
    this.events = [];
    this.frame++;
    const dtS = 1 / 60;
    if (!this.alive) { this.v += (0 - this.v) * 0.022; this.advance(); this.updateFold(); return this.events; }
    this.time += dtS;

    if (this.invul > 0) this.invul -= dtS;
    if (this.mode === 'timetrial') {
      this.timeLeft += this.level >= 3 ? dtS : -dtS;
      if (this.timeLeft <= 0) { this.timeLeft = 0; this.die(null); return this.events; }
    }
    if (this.level === 3) { this.boostTime += dtS; this.boostTotal += dtS; }

    // Orden de Game::update: Tunnel::update (plegado), BoxManager::update (cajas de la fila
    // nueva, movimiento y choques), Player::update (avance, giro, placas, velocidad)
    this.updateFold();
    if (this.pendingRow) { this.pendingRow = false; const last = this.rows[this.rows.length - 1]; this.updateBoxes(last); this.spawnCoins(last); }
    this.updateBoxMotion();
    this.checkCollisions();
    if (!this.alive) return this.events;
    this.advance();
    this.steer(input.steer || 0);
    this.checkBoost();
    this.updateSpeed();
    this.checkCoins();
    this.prune();
    return this.events;
  }

  advance() {                          // Player::updatePosition
    const before = Math.floor(this.s);
    this.s += this.v / R_UNITS;
    const after = Math.floor(this.s);
    for (let r = before; r < after; r++) {
      this.pushRow(false);
      if (this.alive) this.rowsPassed++;
    }
  }

  updateSpeed() {                      // Player::updateSpeed
    if (this.mode === 'survival') {
      this.v += 0.0005; this.vTarget = this.v;       // como el original: el objetivo es v + 0,0005
      if (this.v > V_MAX) this.v = V_MAX;
      return;
    }
    const d = this.vTarget - this.v;
    if (Math.abs(d) > V_EPS) this.v += d * (this.v < this.vTarget ? V_UP : V_DOWN);
  }

  checkBoost() {                       // Player::checkForBoost
    const cur = Math.floor(this.s), f = this.s - cur;
    for (const p of this.pads) {
      if (p.taken) continue;
      if (!((p.k === cur + 1 && f > 0.5) || p.k === cur)) continue;
      const a = laneAngle(p.lane);
      const hw = 0.314159;
      const lo = wrapAngle(a - hw), hi = wrapAngle(a + hw);
      if (!angleIn(wrapAngle(this.theta), lo, hi)) continue;
      // checkForBoost exige que ni la fila actual ni la siguiente estén ya usadas, y marca las dos
      const r0 = this.rowAt(cur), r1 = this.rowAt(cur + 1);
      if ((r0 && r0.taken) || (r1 && r1.taken)) continue;
      if (r0) r0.taken = true;
      if (r1) r1.taken = true;
      for (const q of this.pads) if (q.k === p.k) q.taken = true;
      p.got = true;
      this.initBoost();
    }
  }

  updateBoxMotion() {
    const edge = 90 - this.fold;
    for (const b of this.boxes) {
      if (b.grow < 1) b.grow = Math.min(1, b.grow + 0.027);
      if (b.fixed || b.hit) continue;
      // Box::update: o gira o llega (no las dos cosas en el mismo fotograma): 41 fotogramas por carril
      if (Math.abs(b.roll) < edge) { b.roll += b.rollSpeed; continue; }
      {
        b.roll = 0;
        let next = b.lane + Math.sign(b.rollSpeed);
        b.lane = mod(next, LANES);
        // en lámina abierta rebotan al llegar al borde, sin salirse; en tubo (dentro o fuera) dan la vuelta
        if (this.fold !== FOLD_IN && this.fold !== FOLD_OUT && ((b.lane === LANES - 1 && b.rollSpeed > 0) || (b.lane === 0 && b.rollSpeed < 0))) b.rollSpeed = -b.rollSpeed;
      }
    }
  }

  boxAngle(b) {
    if (b.fixed) return laneAngle(b.lane);
    const edge = 90 - this.fold;
    return laneAngle(b.lane) + (b.roll / edge) * CELL_DEG * DEG;
  }

  checkCollisions() {                  // Box::collisionCheck
    const cur = Math.floor(this.s), f = this.s - cur;
    const hw = stripHalfWidth(this.fold);
    const th = this.theta;
    const open = this.fold !== FOLD_IN && this.fold !== FOLD_OUT;
    const inside = (c) => {
      let lo = c - hw, hi = c + hw;
      if (open) return th > lo && th < hi;
      return angleIn(wrapAngle(th), wrapAngle(lo), wrapAngle(hi));
    };
    for (const b of this.boxes) {
      if (b.hit) continue;
      const a = this.boxAngle(b);
      // 0x104 del original es la fila actual y 0xfc la siguiente
      if (b.tall) {
        if (b.k !== cur + 1) continue;
        if (inside(a) || (this.fold > 27 && inside(a + Math.PI))) this.crash(b);
      } else {
        if (!((b.k === cur + 1 && f > 0.5) || b.k === cur)) continue;
        if (inside(a)) this.crash(b);
      }
    }
  }

  prune() {
    const k0 = Math.floor(this.s) - 2;
    if (this.boxes.length && this.boxes[0].k < k0) this.boxes = this.boxes.filter((b) => b.k >= k0);
    if (this.pads.length && this.pads[0].k < k0) this.pads = this.pads.filter((p) => p.k >= k0);
    if (this.coins.length && this.coins[0].k < k0) this.coins = this.coins.filter((c) => c.k >= k0);
    if (this.gaps.length && this.gaps[0].to < k0 - 4) this.gaps.shift();
  }

  event(type, data) { this.events.push(Object.assign({ type, frame: this.frame }, data)); }

  // ------------------------------------------------------------------ consultas para dibujar
  // Color de aviso de cada celda: el de la última caja fija de ese carril que la cubre.
  // Devuelve un Map lane -> [{ from, to, color }] con tramos de filas.
  litStrips() {
    const near = Math.floor(this.s);
    const out = new Map();
    for (const b of this.boxes) {
      if (!b.fixed || b.hit) continue;
      const add = (lane) => { if (!out.has(lane)) out.set(lane, []); out.get(lane).push({ from: near, to: b.k, color: b.color, id: b.id }); };
      add(b.lane);
      if (b.opp >= 0 && this.fold > 27) add(b.opp);
    }
    return out;
  }

  playerStrips() {
    const res = [];
    for (let l = 0; l < LANES && res.length < 2; l++) if (this.onStrip(l)) res.push(l);
    return res;
  }

  // altura del salto sobre la carretera en la posición s (en filas); 0 fuera de los huecos
  jumpAt(s) {
    for (const g of this.gaps) {
      const a = g.from - 3, b = g.to + 1;
      if (s > a && s < b) { const t = (s - a) / (b - a); return 4 * 5.5 * t * (1 - t); }
    }
    return 0;
  }
  inGap(k) { for (const g of this.gaps) if (k >= g.from && k <= g.to) return true; return false; }

  get distanceM() { return this.rowsPassed * ROW_M; }
  get speedMS() { return this.v * 60 * M_PER_UNIT; }
}
