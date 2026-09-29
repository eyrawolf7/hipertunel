// Traza de una partida con la simulación en JS (la de referencia), conducida por el bot en JS.
// Uso: node trace.mjs <classic|survival|timetrial> <semilla> <fotogramas> [god]
// Debe dar exactamente la misma salida que trace.c.
import { Game } from '../../../app/src/sim/game.js';
import { botSteer } from '../../../app/src/sim/bot.js';
import { Arcade } from '../../../app/src/sim/arcade.js';

const [mode, seedS, framesS, godS] = process.argv.slice(2);
const seed = Number(seedS) >>> 0, frames = Number(framesS), god = godS === 'god';

// %.9g de printf
function g9(x) {
  if (x === 0) return Object.is(x, -0) ? '-0' : '0';
  if (!Number.isFinite(x)) return Number.isNaN(x) ? 'nan' : x > 0 ? 'inf' : '-inf';
  const [m, ex] = x.toExponential(8).split('e');
  const E = Number(ex);
  if (E < -4 || E >= 9) return m.replace(/\.?0+$/, '') + 'e' + (E < 0 ? '-' : '+') + String(Math.abs(E)).padStart(2, '0');
  let s = x.toFixed(8 - E);
  if (s.includes('.')) s = s.replace(/\.?0+$/, '');
  return s;
}
const hex = (h) => (h >>> 0).toString(16).padStart(8, '0');

let H = 0;
const hu = (x) => { H = Math.imul((H ^ x) >>> 0, 16777619) >>> 0; };
const hi = (x) => hu((typeof x === 'boolean' ? (x ? 1 : 0) : x) >>> 0);
const dv = new DataView(new ArrayBuffer(8));
const hd = (x) => { dv.setFloat64(0, x, true); hu(dv.getUint32(0, true)); hu(dv.getUint32(4, true)); };

function hashObjects(g) {
  H = 2166136261;
  hi(g.boxes.length);
  for (const b of g.boxes) { hi(b.id); hi(b.k); hi(b.lane); hi(b.fixed); hi(b.tall); hi(b.hit); hi(b.opp); hi(b.color); hi(b.group); hi(b.joined); }
  hi(g.pads.length);
  for (const p of g.pads) { hi(p.k); hi(p.lane); hi(p.taken); }
  hi(g.coins.length);
  for (const c of g.coins) { hi(c.k); hi(c.lane); hi(c.got); }
  hi(g.gaps.length);
  for (const x of g.gaps) { hi(x.from); hi(x.to); }
  return H;
}

function hashBits(g) {
  H = 2166136261;
  for (const x of [g.s, g.theta, g.omega, g.v, g.vTarget, g.fold, g.timeLeft, g.time, g.invul, g.boostTime, g.maxBoostTime, g.coinStreakT]) hd(x);
  hd(g.boostTotal); hi(g.pendingRow);
  const t = g.turn;
  for (const x of [t.yawT, t.pitchT, t.dYaw, t.dPitch, t.thr]) hd(x);
  for (const r of g.rows) { hi(r.k); hd(r.yaw); hd(r.pitch); hi(r.taken); }
  for (const b of g.boxes) { hd(b.h); hd(b.roll); hd(b.rollSpeed); hd(b.grow); }
  return H;
}

const g = mode === 'arcade' ? new Arcade({ seed }) : new Game({ mode, seed });
if (god) {
  // choque sin consecuencias en los choques mortales; igual que g->god en game.c
  g.crash = function (box) {
    if (this.invul > 0 || box.hit || !this.alive) return;
    box.hit = true;
    this.v = 1.0;
    const fatal = !this.boostOn || this.mode === 'survival';
    this.event('crash', { id: box.id, lane: box.lane, k: box.k, fatal });
    if (fatal) return;
    this.invul = 1.5;
    this.disableBoost();
    if (this.mode === 'timetrial') this.timeLeft += Math.max(-5 - this.crashes, -15);
    this.crashes++;
  };
}
const out = [];
const P = (s) => out.push(s);
const b01 = (x) => (x ? 1 : 0);
P(`start mode=${mode} seed=${seed} waves=${g.waves.length} rng=${g.rng.state >>> 0} crng=${g.coinRng.state >>> 0} lastLoc=${g.lastLoc}`);
let deadAt = -1;
while (g.frame < frames) {
  if (god && g.mode === 'timetrial' && g.timeLeft < 10) g.timeLeft += 60;
  const st = botSteer(g, 14);
  const ev = g.step({ steer: st });
  if (g.frame % 60 === 0 || ev.length > 0) {
    P(`f=${g.frame} s=${g9(g.s)} th=${g9(g.theta)} v=${g9(g.v)} vt=${g9(g.vTarget)} lv=${g.level} wi=${g.waveIdx} wl=${g.waveLeft} fold=${g9(g.fold)} w=${g.world} al=${b01(g.alive)} nb=${g.boxes.length} np=${g.pads.length} nc=${g.coins.length} cg=${g.coinsGot} tl=${g9(g.timeLeft)} st=${g9(st)} h=${hex(hashObjects(g))} b=${hex(hashBits(g))} rng=${g.rng.state >>> 0} crng=${g.coinRng.state >>> 0}`);
    for (const e of ev) {
      let s = `  ev ${e.type}`;
      switch (e.type) {
        case 'world': s += ` world=${e.world}`; break;
        case 'wave': s += ` wave=${e.wave}`; break;
        case 'spawn': s += ` id=${e.id}`; break;
        case 'coin': s += ` combo=${e.combo} lane=${e.lane} k=${e.k}`; break;
        case 'foldStart': s += ` toIn=${b01(e.toIn)}`; break;
        case 'foldEnd': s += ` toIn=${b01(e.toIn)} world=${e.world}`; break;
        case 'boost': s += ` level=${e.level}`; break;
        case 'crash': s += ` id=${e.id} lane=${e.lane} k=${e.k} fatal=${b01(e.fatal)}`; break;
        case 'death': s += ` id=${e.id}`; break;
        case 'camp': s += ` lane=${e.lane}`; break;
      }
      P(s + ` frame=${e.frame}`);
    }
  }
  if (!g.alive && deadAt < 0) deadAt = g.frame;
  if (deadAt >= 0 && g.frame >= deadAt + 120) break;
}
P(`end frame=${g.frame} alive=${b01(g.alive)} dist=${g9(g.distanceM)} coins=${g.coinsGot} crashes=${g.crashes} waveIdx=${g.waveIdx}`);
process.stdout.write(out.join('\n') + '\n');
