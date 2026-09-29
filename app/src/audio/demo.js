import { createAudio } from './index.js';

const audio = createAudio({ debug: true });
window.__audio = audio;
const $ = (id) => document.getElementById(id);
let speed = 18, level = 0;

function btn(parent, label, fn) {
  const b = document.createElement('button');
  b.textContent = label;
  b.onclick = () => { audio.unlock(); fn(b); };
  parent.appendChild(b);
  return b;
}

$('unlock').onclick = () => audio.unlock();
let music = true, paused = false;
$('music').onclick = (e) => { audio.unlock(); music = !music; audio.setMusic(music); e.target.classList.toggle('on', music); };
$('mute').onclick = (e) => { audio.unlock(); audio.setMuted(!audio.muted); e.target.classList.toggle('on', audio.muted); };
$('pause').onclick = (e) => { paused = !paused; audio.pause(paused); e.target.classList.toggle('on', paused); };

const names = ['0 Pradera', '1 transición', '2 Neón', '3 transición', '4 Cristal', '5 transición', '6 Volcán'];
names.forEach((n, i) => btn($('worlds'), n, () => { audio.setWorld(i); if (i % 2 === 0) audio.play('world'); }));

$('speed').oninput = (e) => { speed = +e.target.value; $('speedv').textContent = speed; };
$('level').oninput = (e) => { level = +e.target.value; $('levelv').textContent = level; };
$('ramp').onclick = () => {
  audio.unlock();
  const t0 = performance.now();
  const id = setInterval(() => {
    const k = Math.min(1, (performance.now() - t0) / 6000);
    speed = Math.round(18 + 82 * k); $('speed').value = speed; $('speedv').textContent = speed;
    if (k >= 1) clearInterval(id);
  }, 50);
};

const sfx = [
  ['boost', { level: 1 }, 'boost 1'], ['boost', { level: 2 }, 'boost 2'], ['boost', { level: 3 }, 'boost 3'],
  ['crash'], ['death'], ['foldStart'], ['foldEnd'], ['world'],
  ['coin', { combo: 0 }, 'coin'], ['coin', { combo: 3 }, 'coin x3'], ['coin', { combo: 9 }, 'coin x9'],
  ['menuMove'], ['menuOk'], ['menuBack'], ['countdown'], ['go'], ['record'], ['nearMiss'],
  ['jump'], ['land'], ['smash'], ['whiff'], ['creak', { k: 0.8 }], ['collapse'],
];
for (const [name, opts, label] of sfx) btn($('sfx'), label || name, () => audio.play(name, opts));
btn($('sfx'), 'Cuenta atrás completa', () => {
  [0, 1, 2].forEach((i) => audio.play('countdown', { delay: i * 0.8 }));
  audio.play('go', { delay: 2.4 });
});

let hover = false;
btn($('sfx'), 'Tabla (hover)', (b) => { hover = !hover; b.classList.toggle('on', hover); });

(function loop() {
  audio.setSpeed(speed, level);
  audio.setHover(hover, (speed - 18) / 82);
  requestAnimationFrame(loop);
})();
