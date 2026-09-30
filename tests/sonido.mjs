// Renderiza sin conexión unos segundos de música + turbina + efectos y guarda WAV y espectrograma.
// Uso: node tests/sonido.mjs [mundo] [nivel] [velocidad m/s] [segundos]
// ZORRO=1: secuencia del modo Zorro (tabla flotante + jump/land/whiff/smash) y pico de cada efecto por separado.
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
// --musica: la música reacciona (remate del nivel 3 sobre la rejilla, ahogo al chocar, se abre con el impulso)
const musica = process.argv.includes('--musica');
const [world = 0, level = 2, speed = 80, secs = 10] = process.argv.slice(2).filter((x) => !x.startsWith('--')).map(Number);
const dir = new URL('./shots/sonido/', import.meta.url).pathname; mkdirSync(dir, { recursive: true });
const b = await puppeteer.launch({ headless: 'new' });
const p = await b.newPage();
await p.goto((process.env.HIP_URL || 'http://localhost:5173/') + 'src/audio/demo.html', { waitUntil: 'networkidle0' });
if (process.env.SIN_MUSICA) await p.evaluate(() => { window.__noMusic = true; });
if (musica) {
  const r = await p.evaluate(async () => {
    const { createAudio } = await import('/src/audio/index.js');
    const sr = 44100, secs = 7, out = { grid: [], duck: {} };
    // 1) el remate del nivel 3 cae a < 10 ms de un paso de la rejilla (varios desfases, varios mundos)
    for (const w of [0, 2, 4]) for (let k = 0; k < 8; k++) {
      const log = [], ctx = new OfflineAudioContext(1, sr * secs, sr), a = createAudio({ context: ctx, log });
      a.unlock(); a.setMusic(true); a.setWorld(w); a.setSpeed(80, 3);
      a.play('boost', { level: 3, delay: 1 + k * 0.0173 + w * 0.031 });
      a._scheduleUntil(secs);
      const steps = log.filter((e) => e.what === 'step').map((e) => e.t), rem = log.find((e) => e.what === 'remate');
      const err = Math.min(...steps.map((s) => Math.abs(s - rem.t)));
      const wait = rem.t - (1 + k * 0.0173 + w * 0.031 + 0.005 + 0.12 + 3 * 0.045);
      out.grid.push({ w, k, errMs: err * 1000, waitMs: wait * 1000 });
    }
    // 1b) escenarios que mueven state.nextTime (el error 0,000 de arriba es casi tautológico: rem y pasos salen de la
    // misma nextTime). La referencia es una segunda pasada IDÉNTICA SIN impulso: sus pasos no dependen de nextGridTime.
    // No se puede medir el remate en el audio renderizado: el compresor maestro y la música (5-8 veces más fuerte
    // en 2960 Hz que el remate) tapan la resta A-B; haría falta un gancho _muteMusicBus() en el audio.
    out.esc = [];
    const escenarios = {
      'nextTime por delante': (a, boost) => { a._scheduleUntil(1.5); boost(1.0); },
      'tras pausa/reanudar': (a, boost) => { a.pause(true); a.pause(false); a._scheduleUntil(0.6); boost(1.0); },
      'cambio de bpm (mundo 0 a 2)': (a, boost) => { a._scheduleUntil(0.9); a.setWorld(2); boost(1.0); },
      'cambio de bpm (mundo 2 a 4)': (a, boost) => { a.setWorld(2); a._scheduleUntil(0.9); a.setWorld(4); boost(1.0); },
      'musica apagada': (a, boost) => { a.setMusic(false); boost(1.0); },
      'silenciado': (a, boost) => { a.setMuted(true); boost(1.0); },
    };
    for (const [nombre, fn] of Object.entries(escenarios)) for (const dl of [0, 0.037, 0.071]) {
      const run = (con) => {
        const log = [], ctx = new OfflineAudioContext(1, sr * secs, sr), a = createAudio({ context: ctx, log });
        a.unlock(); a.setMusic(true); a.setWorld(0); a.setSpeed(80, 3);
        fn(a, (t) => { if (con) a.play('boost', { level: 3, delay: t + dl }); });
        a._scheduleUntil(secs);
        return log;
      };
      const A = run(true), B = run(false);
      const sA = A.filter((e) => e.what === 'step').map((e) => e.t), sB = B.filter((e) => e.what === 'step').map((e) => e.t);
      const rem = A.find((e) => e.what === 'remate');
      const musicaOn = !/apagada|silenciado/.test(nombre);
      const err = rem && sB.length ? Math.min(...sB.map((s) => Math.abs(s - rem.t))) * 1000 : NaN;
      out.esc.push({ nombre, dl, remate: !!rem, errMs: err, musicaOn, igual: sA.length === sB.length && sA.every((t, i) => Math.abs(t - sB[i]) < 1e-9) });
    }
    // 2) el ahogo: energía de agudos (diferencia de primer orden) frente a la misma música sin choque
    const render = async (fn) => {
      const ctx = new OfflineAudioContext(1, sr * secs, sr), a = createAudio({ context: ctx, log: [] });
      a.unlock(); a.setMusic(true); a.setWorld(0); a.setSpeed(80, 3);
      fn(a); a._scheduleUntil(secs);
      return (await ctx.startRendering()).getChannelData(0);
    };
    const hf = (d, t0, t1) => { let e = 0, n = 0; for (let i = Math.floor(t0 * sr) + 1; i < Math.floor(t1 * sr); i++) { const x = d[i] - d[i - 1]; e += x * x; n++; } return e / n; };
    const ref = await render(() => {});
    const mu = await render((a) => a.play('muffle', { delay: 3 }));
    const mb = await render((a) => { a.play('muffle', { delay: 3 }); a.play('muffle', { open: true, delay: 3.15 }); });
    out.duck = {
      ahogado: hf(mu, 3.05, 3.45) / hf(ref, 3.05, 3.45),
      abierto: hf(mu, 4.6, 5.6) / hf(ref, 4.6, 5.6),
      conImpulso: hf(mb, 3.4, 3.7) / hf(ref, 3.4, 3.7),
      sinImpulso: hf(mu, 3.4, 3.7) / hf(ref, 3.4, 3.7),
    };
    return out;
  });
  await b.close();
  let bad = 0;
  for (const g of r.grid) if (g.errMs >= 10) { bad++; console.log('FALLA rejilla', JSON.stringify(g)); }
  const maxErr = Math.max(...r.grid.map((g) => g.errMs)), maxWait = Math.max(...r.grid.map((g) => g.waitMs));
  console.log(`remate: ${r.grid.length} casos, error máx ${maxErr.toFixed(3)} ms a la rejilla, espera añadida máx ${maxWait.toFixed(0)} ms`);
  for (const nombre of [...new Set(r.esc.map((e) => e.nombre))]) {
    const xs = r.esc.filter((e) => e.nombre === nombre), musicaOn = xs[0].musicaOn;
    const ok = musicaOn ? xs.every((e) => e.remate && e.errMs < 10 && e.igual) : xs.every((e) => (nombre === 'silenciado' ? !e.remate : e.remate) && e.igual);
    if (!ok) bad++;
    console.log(ok ? 'PASA ' : 'FALLA', 'remate,', nombre + ':', musicaOn ? `error máx ${Math.max(...xs.map((e) => e.errMs)).toFixed(3)} ms` : (nombre === 'silenciado' ? 'sin remate' : 'sin cuantizar'), '· rejilla intacta', xs.every((e) => e.igual));
  }
  const d = r.duck; console.log('agudos (frente a sin choque): ahogado', d.ahogado.toFixed(3), '· abierto', d.abierto.toFixed(3), '· a 0,4 s sin impulso', d.sinImpulso.toFixed(3), '· a 0,25 s con impulso', d.conImpulso.toFixed(3));
  const okDuck = d.ahogado < 0.5 && d.abierto > 0.9 && d.abierto < 1.1 && d.conImpulso > d.sinImpulso;
  if (!okDuck) console.log('FALLA ahogo');
  console.log(bad || !okDuck ? 'MÚSICA: FALLA' : 'MÚSICA: OK');
  process.exit(bad || !okDuck ? 1 : 0);
}
const zorro = !!process.env.ZORRO;
if (zorro) await p.evaluate(() => { window.__zorro = true; });
const data = await p.evaluate(async (world, level, speed, secs) => {
  const { createAudio } = await import('/src/audio/index.js');
  const sr = 44100, ctx = new OfflineAudioContext(1, sr * secs, sr);
  const a = createAudio({ context: ctx });
  a.unlock(); a.setMusic(!(window.__noMusic)); a.setWorld(world); a.setSpeed(speed, level);
  let solo = null;
  if (window.__zorro) {
    // tabla encendida desde el principio, acelera a los 3 s, se apaga a secs-2
    a.setHover(true, 0.2);
    ctx.suspend(3).then(() => { a.setHover(true, 0.9); ctx.resume(); });
    ctx.suspend(Math.max(4, secs - 2)).then(() => { a.setHover(false); ctx.resume(); });
    for (const [n, d] of [['jump', 1], ['land', 1.6], ['whiff', 2.4], ['smash', 3.2], ['jump', 5], ['land', 5.6], ['whiff', 6.4], ['smash', 6.8]]) if (d < secs) a.play(n, { delay: d });
    // pico de cada efecto aislado (sin música ni turbina), para comparar volúmenes
    solo = {};
    for (const [n, o] of [['coin', { combo: 2 }], ['boost', { level: 1 }], ['crash', {}], ['jump', {}], ['land', {}], ['smash', {}], ['whiff', {}]]) {
      const c2 = new OfflineAudioContext(1, sr * 1.2, sr), a2 = createAudio({ context: c2 });
      a2.unlock(); a2.setMusic(false); a2.play(n, o);
      const d2 = (await c2.startRendering()).getChannelData(0); let pk = 0, e = 0, last = 0;
      for (let i = 0; i < d2.length; i++) { const v = Math.abs(d2[i]); if (v > pk) pk = v; e += v * v; }
      for (let i = 0; i < d2.length; i++) if (Math.abs(d2[i]) > pk * 0.03) last = i;
      solo[n] = `pico ${pk.toFixed(2)} energía ${e.toFixed(0)} dur ${(last / sr).toFixed(2)} s`;
    }
    // zumbido de la tabla aislado: nivel RMS a velocidad 0,2 y 0,9
    for (const v of [0.2, 0.9]) {
      const c3 = new OfflineAudioContext(1, sr * 2, sr), a3 = createAudio({ context: c3 });
      a3.unlock(); a3.setMusic(false); a3.setHover(true, v);
      const d3 = (await c3.startRendering()).getChannelData(0); let q = 0, pk = 0;
      for (let i = sr; i < d3.length; i++) { q += d3[i] * d3[i]; pk = Math.max(pk, Math.abs(d3[i])); }
      solo['hover ' + v] = `pico ${pk.toFixed(3)} rms ${Math.sqrt(q / sr).toFixed(4)}`;
    }
    { // turbina sola a la misma velocidad, como referencia
      const c4 = new OfflineAudioContext(1, sr * 2, sr), a4 = createAudio({ context: c4 });
      a4.unlock(); a4.setMusic(false); a4.setSpeed(speed, level);
      const d4 = (await c4.startRendering()).getChannelData(0); let q = 0;
      for (let i = sr; i < d4.length; i++) q += d4[i] * d4[i];
      solo['turbina ' + speed] = `rms ${Math.sqrt(q / sr).toFixed(4)}`;
    }
  } else {
    a.play('boost', { level: 1, delay: 2 }); a.play('coin', { combo: 2, delay: 4 }); a.play('crash', { delay: 6 });
  }
  a._scheduleUntil(secs);
  const buf = await ctx.startRendering();
  const ch = buf.getChannelData(0); let peak = 0, sum = 0; for (let i = 0; i < ch.length; i++) { const v = Math.abs(ch[i]); if (v > peak) peak = v; sum += v * v; }
  const i16 = new Int16Array(ch.length); for (let i = 0; i < ch.length; i++) i16[i] = Math.max(-1, Math.min(1, ch[i])) * 32767;
  let bin = ''; const u8 = new Uint8Array(i16.buffer); for (let i = 0; i < u8.length; i += 8192) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 8192));
  return { b64: btoa(bin), peak, rms: Math.sqrt(sum / ch.length), sr, solo };
}, world, level, speed, secs);
await b.close();
const pcm = Buffer.from(data.b64, 'base64');
const hdr = Buffer.alloc(44); hdr.write('RIFF', 0); hdr.writeUInt32LE(36 + pcm.length, 4); hdr.write('WAVE', 8); hdr.write('fmt ', 12); hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20); hdr.writeUInt16LE(1, 22); hdr.writeUInt32LE(data.sr, 24); hdr.writeUInt32LE(data.sr * 2, 28); hdr.writeUInt16LE(2, 32); hdr.writeUInt16LE(16, 34); hdr.write('data', 36); hdr.writeUInt32LE(pcm.length, 40);
const wav = `${dir}${zorro ? 'zorro-' : ''}m${world}-n${level}-v${speed}.wav`; writeFileSync(wav, Buffer.concat([hdr, pcm]));
execSync(`ffmpeg -y -loglevel error -i ${wav} -lavfi showspectrumpic=s=1200x500:legend=1:fscale=log ${wav.replace('.wav', '.png')}`);
console.log(wav, 'pico', data.peak.toFixed(2), 'rms', data.rms.toFixed(3));
if (data.solo) for (const [k, v] of Object.entries(data.solo)) console.log('  ' + k.padEnd(14), v);
