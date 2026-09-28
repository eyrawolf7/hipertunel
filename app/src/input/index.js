// Entrada. Todo se traduce a la misma magnitud que usa el original: "a" ≈ 0,981·sen(inclinación),
// ya con el cero calibrado restado. La simulación aplica su zona muerta y su ganancia.
// Teclado, táctil y mando generan un "a" virtual equivalente.

const isIOS = typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function';

export function createInput(target) {
  const st = {
    tiltOn: true, invert: false, sens: 1, cal: 0,
    raw: 0, has: false, motionN: 0, listening: false,
    keys: new Set(), touches: new Map(), holdT: 0, dir: 0,
    pad: { x: 0, dl: false, dr: false, a: false, b: false, start: false, up: false, down: false, prev: {} },
    onButton: null,
  };
  try { st.cal = +(localStorage.getItem('hipertunel-cal') || 0) || 0; } catch (e) {}

  const screenAngle = () => {
    const o = (screen.orientation && typeof screen.orientation.angle === 'number') ? screen.orientation.angle : (window.orientation || 0);
    return ((o % 360) + 360) % 360;
  };
  function onMotion(e) {
    const g = e.accelerationIncludingGravity;
    if (!g || g.x == null || g.y == null) return;
    st.motionN++;
    let x = g.x, y = g.y;
    if (isIOS) { x = -x; y = -y; }
    // gravedad en coordenadas de pantalla: el eje x de la pantalla es el que manda al girar
    const ang = screenAngle();
    let sx;
    if (ang === 90) sx = y; else if (ang === 270) sx = -y; else if (ang === 180) sx = x; else sx = -x;
    st.raw = sx * 0.1;                    // appSetAccel: aceleración × 0,1
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
  el.addEventListener('pointerdown', (e) => { st.touches.set(e.pointerId, { d: e.clientX < innerWidth / 2 ? -1 : 1, t: 0 }); });
  const end = (e) => st.touches.delete(e.pointerId);
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
  const digital = (t) => 0.13 + 0.2 * Math.min(1, t / 0.3);

  return {
    requestTilt,
    get state() { return st; },
    set onButton(fn) { st.onButton = fn; },
    configure({ tilt, invert, sens }) { if (tilt !== undefined) st.tiltOn = tilt; if (invert !== undefined) st.invert = invert; if (sens !== undefined) st.sens = sens; },
    calibrate() { st.cal = st.raw; try { localStorage.setItem('hipertunel-cal', String(st.cal)); } catch (e) {} },
    get tiltValue() { return st.raw - st.cal; },
    get hasTilt() { return st.has; },
    // Llamar una vez por paso de simulación (60 Hz). Devuelve el "a" final.
    steer(dt) {
      pollPad();
      let a = 0, src = 'none';
      const kd = (st.keys.has('ArrowLeft') || st.keys.has('KeyA') ? -1 : 0) + (st.keys.has('ArrowRight') || st.keys.has('KeyD') ? 1 : 0);
      let td = 0; for (const t of st.touches.values()) td = t.d;
      const pd = (st.pad.dl ? -1 : 0) + (st.pad.dr ? 1 : 0);
      const d = kd || td || pd;
      if (d !== 0) {
        if (d !== st.dir) st.holdT = 0; else st.holdT += dt;
        st.dir = d; a = d * digital(st.holdT); src = 'digital';
      } else { st.dir = 0; st.holdT = 0; }
      if (!a && st.pad.x) { a = st.pad.x * 0.42; src = 'pad'; }
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
