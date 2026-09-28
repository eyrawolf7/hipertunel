// Vista previa de la interfaz: monta createUI sobre un túnel falso y cambia de pantalla con el
// hash (#title, #modes, #settings, #hud, #pause, #over, #over-record, #hud-tt, #hud-low).
import { createUI } from './index.js';

// ---- fondo: túnel de anillos de colores suaves, para juzgar contraste ----
const cv = document.getElementById('bg');
const cx = cv.getContext('2d');
let T = 0;
function bg() {
  const w = cv.width = innerWidth * devicePixelRatio, hh = cv.height = innerHeight * devicePixelRatio;
  const g = cx.createLinearGradient(0, 0, 0, hh);
  g.addColorStop(0, '#8fd3ff'); g.addColorStop(.55, '#fdf1ff'); g.addColorStop(1, '#ffd9b8');
  cx.fillStyle = g; cx.fillRect(0, 0, w, hh);
  const mx = w / 2, my = hh * .52;
  for (let i = 22; i >= 0; i--) {
    const z = (i + (T % 1)) / 22;
    const r = Math.max(w, hh) * 0.9 * Math.pow(1 - z, 2.2) + 8;
    cx.beginPath(); cx.arc(mx, my, r, 0, Math.PI * 2);
    cx.fillStyle = i % 2 ? 'rgba(255,255,255,.5)' : 'rgba(230,222,245,.55)';
    cx.fill();
  }
  // cajas de colores
  const cols = ['#ff4b4b', '#ffd23f', '#3fe0a0', '#ff8a3d', '#b36bff'];
  for (let i = 0; i < 9; i++) {
    const a = i * 2.4 + 0.3, z = ((i * .37 + T * .2) % 1);
    const r = Math.max(w, hh) * 0.55 * Math.pow(1 - z, 2) + 20;
    const s = 12 + 160 * Math.pow(1 - z, 2.5);
    cx.fillStyle = cols[i % cols.length];
    cx.fillRect(mx + Math.cos(a) * r - s / 2, my + Math.sin(a) * r - s / 2, s, s);
  }
}

const ui = createUI(document.getElementById('ui'), {
  onPlay: (m) => { console.log('onPlay', m); location.hash = 'hud'; },
  onResume: () => { console.log('onResume'); location.hash = 'hud'; },
  onRestart: () => { console.log('onRestart'); location.hash = 'hud'; },
  onMenu: () => { console.log('onMenu'); location.hash = 'title'; },
  onSetting: (k, v) => console.log('onSetting', k, v),
  onCalibrate: () => console.log('onCalibrate'),
  onPause: () => { location.hash = 'pause'; },
  onSound: (n) => console.log('sound', n),
});
window.__ui = ui;
ui.records({ classic: 4821, survival: 1377, timetrial: 0 });
ui.settings({ tilt: true, invert: false, sens: 1.2, quality: 'media', reduceFx: false, music: true, sound: true });

const st = { distM: 1234, speedMS: 42, level: 2, coins: 37, timeLeft: null, mode: 'classic', invul: false, best: 4821 };
let hudMode = null;

function route() {
  const hsh = (location.hash || '#title').slice(1);
  hudMode = null;
  if (hsh === 'over' || hsh === 'over-record') {
    const rec = hsh === 'over-record';
    ui.over({
      mode: 'classic', distM: rec ? 5210 : 2317, coins: 58, score: rec ? 18450 : 8920, best: rec ? 5210 : 4821,
      isRecord: rec, time: 131.4, maxBoostTime: 12.3,
      top: rec
        ? [{ distM: 5210, date: Date.now() }, { distM: 4821, date: Date.now() - 864e5 }, 3950, 2317, 1880]
        : [{ distM: 4821, date: Date.now() - 864e5 }, 3950, { distM: 2317, date: Date.now() }, 1880],
    });
    return;
  }
  if (hsh.startsWith('hud')) {
    hudMode = hsh;
    Object.assign(st, { mode: hsh === 'hud' ? 'classic' : 'timetrial', timeLeft: hsh === 'hud' ? null : (hsh === 'hud-low' ? 7.4 : 42.3) });
    ui.show('hud');
    ui.hud(st);
    return;
  }
  if (hsh === 'toast') { ui.show('hud'); hudMode = 'hud'; ui.hud(st); ui.toast('¡Impulso!', 'boost'); ui.toast('¡Nuevo récord!', 'record'); return; }
  ui.show(hsh);
}
addEventListener('hashchange', route);
route();

let lastT = performance.now();
let frozen = new URLSearchParams(location.search).has('still');
function loop(t) {
  const dt = Math.min(.05, (t - lastT) / 1000); lastT = t;
  if (!frozen) T += dt * 1.5;
  bg();
  if (hudMode && !frozen) {
    st.distM += st.speedMS * dt;
    if (st.timeLeft != null) st.timeLeft = Math.max(0, st.timeLeft - dt);
    ui.hud(st);
  }
  if (ui.screen === 'settings') ui.tiltMeter(Math.sin(t / 700) * .6, 'Sensor activo · 12°');
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
