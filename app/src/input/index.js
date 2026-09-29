// Entrada. Todo se traduce a la misma magnitud que usa el original: "a" ≈ 0,981·sen(inclinación),
// ya con el cero calibrado restado. La simulación aplica su zona muerta y su ganancia.
// Teclado, táctil y mando generan un "a" virtual equivalente.

const isIOS = typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function';

export function createInput(target) {
  const st = {
    tiltOn: true, invert: false, sens: 1, cal: 0,
    raw: 0, has: false, motionN: 0, listening: false, target: null,
    keys: new Set(), touches: new Map(), holdT: 0, dir: 0,
    pad: { x: 0, dl: false, dr: false, a: false, b: false, start: false, up: false, down: false, prev: {} },
    onButton: null, onTap: null,
    heroMode: false, jumpQ: false, swipe: new Map(),   /* modo Zorro: saltar */
  };
  try { st.cal = +(localStorage.getItem('hipertunel-cal2') || 0) || 0; } catch (e) {}

  // Mismo método que la v0.32, que en el móvil de Víctor iba bien: el ángulo de la gravedad en el
  // plano de la pantalla, medido desde la postura apaisada neutra (múltiplo de π más cercano).
  // No depende del signo de cada sistema (iOS da la gravedad al revés que Android) ni de hacia qué
  // lado esté girado el móvil. La magnitud es la del original: 0,981 · seno de la inclinación.
  function onMotion(e) {
    const g = e.accelerationIncludingGravity;
    if (!g || g.x == null || g.y == null) return;
    if (Math.hypot(g.x, g.y) < 2.5) return;            // móvil casi plano: sin dato fiable
    st.motionN++;
    const phi = Math.atan2(g.y, g.x);
    const base = Math.round(phi / Math.PI) * Math.PI;
    const d = Math.atan2(Math.sin(phi - base), Math.cos(phi - base));
    // magnitud exacta del original: el valor bruto del acelerómetro en el eje lateral, ×0,1. Ese
    // valor incluye cuánto reclinas el móvil hacia atrás (la gravedad que cae en el plano de la
    // pantalla); con solo 0,981·sen(d) girábamos 1,15-1,4 veces más rápido que Boost 2.
    st.raw = Math.hypot(g.x, g.y) * 0.1 * Math.sin(d);
    st.has = true;
  }
  function listen() {
    if (st.listening) return;
    st.listening = true;
    addEventListener('devicemotion', onMotion);
  }
  async function requestTilt() {
    try {
      if (isIOS) { const r = await DeviceMotionEvent.requestPermission(); if (r === 'granted') listen(); }
      else if (typeof DeviceMotionEvent !== 'undefined') listen();
    } catch (e) {}
  }
  if (typeof DeviceMotionEvent !== 'undefined' && !isIOS) listen();

  addEventListener('keydown', (e) => {
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) e.preventDefault();
    if (e.repeat) return;
    st.keys.add(e.code);
    st.onButton && st.onButton(keyName(e.code));
  });
  addEventListener('keyup', (e) => st.keys.delete(e.code));
  addEventListener('blur', () => { st.keys.clear(); st.touches.clear(); });

  const el = target;
  el.addEventListener('pointerdown', (e) => {
    // modo Zorro: con inclinación, tocar = saltar (la pausa va en su botón); sin sensor, los toques
    // giran y el salto es deslizar hacia arriba
    if (st.heroMode) {
      st.swipe.set(e.pointerId, e.clientY);
      if (e.pointerType === 'mouse' || (st.tiltOn && st.has)) { st.jumpQ = true; return; }
    }
    // jugando con inclinación (o con ratón) la pantalla no sirve para girar: un toque pausa, por si
    // hay que parar. Sin sensor, los toques siguen girando (izquierda / derecha).
    if (e.pointerType === 'mouse' || (st.tiltOn && st.has)) { st.onTap && st.onTap(); return; }
    st.touches.set(e.pointerId, { d: e.clientX < innerWidth / 2 ? -1 : 1, t: 0 });
  });
  const end = (e) => st.touches.delete(e.pointerId);
  el.addEventListener('pointermove', (e) => {
    const y0 = st.swipe.get(e.pointerId);
    if (st.heroMode && y0 !== undefined && y0 - e.clientY > 40) { st.jumpQ = true; st.swipe.delete(e.pointerId); st.touches.delete(e.pointerId); }
  });
  el.addEventListener('pointerup', (e) => st.swipe.delete(e.pointerId));
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end); el.addEventListener('pointerleave', end);

  function pollPad() {
    let gps = null;
    try { gps = navigator.getGamepads ? navigator.getGamepads() : null; } catch (e) { gps = null; }
    const p = st.pad;
    p.x = 0; p.dl = p.dr = p.a = p.b = p.start = p.up = p.down = false;
    if (!gps) return;
    for (const gp of gps) {
      if (!gp || !gp.connected) continue;
      const ax = gp.axes[0] || 0;
      p.x = Math.abs(ax) > 0.12 ? ax : 0;
      const b = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed);
      p.dl = b(14); p.dr = b(15); p.up = b(12) || (gp.axes[1] || 0) < -0.6; p.down = b(13) || (gp.axes[1] || 0) > 0.6;
      p.a = b(0); p.b = b(1); p.start = b(9);
      break;
    }
    for (const k of ['a', 'b', 'start', 'up', 'down', 'dl', 'dr']) {
      if (p[k] && !p.prev[k] && st.onButton) st.onButton({ a: 'ok', b: 'back', start: 'pause', up: 'up', down: 'down', dl: 'left', dr: 'right' }[k]);
      p.prev[k] = p[k];
    }
  }

  // "a" virtual para control digital: arranca suave (un toque = un carril) y acelera si mantienes
  const digital = (t) => 0.3 + 0.12 * Math.min(1, t / 0.3);
  const HOLD = 0.18;
  const assist = (diff, open) => { const dd = open ? diff : Math.atan2(Math.sin(diff), Math.cos(diff)); return Math.max(-0.42, Math.min(0.42, dd * 2.5)); };

  return {
    requestTilt,
    get state() { return st; },
    set onButton(fn) { st.onButton = fn; },
    set onTap(fn) { st.onTap = fn; },
    set heroMode(v) { st.heroMode = !!v; st.jumpQ = false; },
    // salto pedido desde el último paso (toque, deslizar, Espacio/↑/W o botón A del mando)
    consumeJump() { const j = st.jumpQ || ((st.keys.has('Space') || st.keys.has('ArrowUp') || st.keys.has('KeyW') || st.pad.a) && !st.jumpHeld); st.jumpHeld = st.keys.has('Space') || st.keys.has('ArrowUp') || st.keys.has('KeyW') || st.pad.a; st.jumpQ = false; return j; },
    configure({ tilt, invert, sens }) { if (tilt !== undefined) st.tiltOn = tilt; if (invert !== undefined) st.invert = invert; if (sens !== undefined) st.sens = sens; },
    calibrate() { st.cal = st.raw; try { localStorage.setItem('hipertunel-cal2', String(st.cal)); } catch (e) {} },
    get tiltValue() { return st.raw - st.cal; },
    get hasTilt() { return st.has; },
    // Llamar una vez por paso de simulación (60 Hz). Devuelve el "a" final.
    // theta: ángulo actual del jugador; open: lámina abierta (sin vuelta).
    steer(dt, theta = 0, open = false) {
      pollPad();
      let a = 0, src = 'none';
      const kd = (st.keys.has('ArrowLeft') || st.keys.has('KeyA') ? -1 : 0) + (st.keys.has('ArrowRight') || st.keys.has('KeyD') ? 1 : 0);
      let td = 0; for (const t of st.touches.values()) td = t.d;
      const pd = (st.pad.dl ? -1 : 0) + (st.pad.dr ? 1 : 0);
      const d = kd || td || pd;
      // Control digital con asistencia de carril: un toque lleva al centro del carril siguiente;
      // mantener desliza de forma continua y al soltar encaja en el carril hacia el que ibas.
      const L = Math.PI / 6, u = theta / L;
      if (d !== 0) {
        if (d !== st.dir) { st.holdT = 0; st.target = d > 0 ? Math.floor(u + 0.35) + 1 : Math.ceil(u - 0.35) - 1; }
        // en la lámina abierta no hay carriles fuera del 0..11: el objetivo se queda dentro
        if (open) st.target = Math.max(0, Math.min(11, st.target));
        else st.holdT += dt;
        st.dir = d; src = 'digital';
        if (st.holdT < HOLD) a = assist(st.target * L - theta, open);
        else { a = d * digital(st.holdT - HOLD); st.target = d > 0 ? Math.ceil(u - 0.05) : Math.floor(u + 0.05); }
      } else {
        st.dir = 0; st.holdT = 0;
        if (st.target !== null) {
          const diff = st.target * L - theta;
          const dd = open ? diff : Math.atan2(Math.sin(diff), Math.cos(diff));
          if (open && (st.target < 0 || st.target > 11)) st.target = Math.max(0, Math.min(11, st.target));
          a = assist(diff, open);
          // se da por llegado antes de caer por debajo de la zona muerta de la simulación (0,019):
          // si no, la asistencia se quedaría pidiendo un giro que no mueve y bloquearía la inclinación
          if (Math.abs(dd) < 0.01 || Math.abs(a) < 0.02) { st.target = null; a = 0; } else src = 'digital';
        }
      }
      if (!a && st.pad.x) { a = st.pad.x * 0.42; src = 'pad'; st.target = null; }
      if (!a && st.tiltOn && st.has) { a = (st.raw - st.cal) * st.sens; if (st.invert) a = -a; src = 'tilt'; }
      st.src = src;
      return a;
    },
  };
}

function keyName(code) {
  if (code === 'Enter' || code === 'Space') return 'ok';
  if (code === 'Escape' || code === 'Backspace') return 'back';
  if (code === 'KeyP') return 'pause';
  if (code === 'ArrowUp' || code === 'KeyW') return 'up';
  if (code === 'ArrowDown' || code === 'KeyS') return 'down';
  if (code === 'ArrowLeft') return 'left';
  if (code === 'ArrowRight') return 'right';
  if (code === 'KeyM') return 'mute';
  return code;
}
