// Renderiza sin conexión unos segundos de música + turbina + efectos y guarda WAV y espectrograma.
// Uso: node tests/sonido.mjs [mundo] [nivel] [velocidad m/s] [segundos]
// ZORRO=1: secuencia del modo Zorro (tabla flotante + jump/land/whiff/smash) y pico de cada efecto por separado.
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
const [world = 0, level = 2, speed = 80, secs = 10] = process.argv.slice(2).map(Number);
const dir = new URL('./shots/sonido/', import.meta.url).pathname; mkdirSync(dir, { recursive: true });
const b = await puppeteer.launch({ headless: 'new' });
const p = await b.newPage();
await p.goto((process.env.HIP_URL || 'http://localhost:5173/') + 'src/audio/demo.html', { waitUntil: 'networkidle0' });
if (process.env.SIN_MUSICA) await p.evaluate(() => { window.__noMusic = true; });
if (process.argv.includes('--capas')) {
  // tras el salto entre mundos: compás en silencio y la música crece por escalones (un compás por capa)
  const r = await p.evaluate(async () => {
    const { createAudio } = await import('/src/audio/index.js');
    const sr = 44100, bpmWorld = 2, nBars = 8;
    const out = {};
    for (const [name, entry] of [['entrada', true], ['sin salto', false], ['reinicio desde tránsito', null]]) {
      const ctx = new OfflineAudioContext(1, sr * 40, sr);
      const a = createAudio({ context: ctx });
      a.unlock(); a.setMusic(true); a.setWorld(entry === false ? bpmWorld : bpmWorld - 1); a.setSpeed(0, 3);
      if (entry) a.setWorld(bpmWorld);
      if (entry === null) a.setWorld(bpmWorld, { restart: true }); // reintento en el mundo 2 desde el tránsito: no es un salto, suena entero
      const bar = a._barDur;
      a._scheduleUntil(bar * (nBars + 1));
      const ch = (await ctx.startRendering()).getChannelData(0);
      const rms = [], agudos = [];
      for (let b = 0; b < nBars; b++) {
        let q = 0, d = 0; const i0 = Math.max(1, Math.floor(b * bar * sr)), i1 = Math.floor((b + 1) * bar * sr);
        for (let i = i0; i < i1; i++) { q += ch[i] * ch[i]; const x = ch[i] - ch[i - 1]; d += x * x; }
        rms.push(Math.sqrt(q / (i1 - i0))); agudos.push(Math.sqrt(d / (i1 - i0)));
      }
      out[name] = { bar, rms, agudos };
    }
    return out;
  });
  await b.close();
  const e = r.entrada.rms, s = r['sin salto'].rms;
  console.log('compás', r.entrada.bar.toFixed(2), 's · RMS por compás (entrada):', e.map((v) => v.toFixed(4)).join(' '));
  console.log('RMS por compás (sin salto):', s.map((v) => v.toFixed(4)).join(' '));
  const fails = [];
  // el compás 0 lleva solo el resto del barrido de la transición (sin música)
  if (e[0] > 0.3 * e[4]) fails.push('el primer compás no es casi silencio');
  const g = r.entrada.agudos;
  console.log('agudos por compás (entrada):', g.map((v) => v.toFixed(4)).join(' '));
  // el compresor de master aplana el RMS total: bajo (1) y bombo (2) se ven en el RMS, caja/hats/arpegio (3) y melodía (4) en los agudos
  for (let i = 1; i <= 2; i++) if (!(e[i] > e[i - 1] * 1.1)) fails.push(`el compás ${i} no crece sobre el anterior`);
  for (let i = 3; i <= 4; i++) if (!(g[i] > g[i - 1] * 1.1)) fails.push(`los agudos del compás ${i} no crecen sobre el anterior`);
  if (!(e[4] > e[3] * 0.9)) fails.push('la melodía no mantiene la energía');
  if (!(s[0] > e[0] * 3)) fails.push('sin salto el primer compás debería sonar');
  if (!(r['reinicio desde tránsito'].rms[0] > e[0] * 3)) fails.push('reiniciar desde el tránsito deja el primer compás en silencio');
  const tail =Math.abs(e[7] - s[7]) / s[7];
  if (tail > 0.25) fails.push(`pasados 5 compases la energía difiere ${(tail * 100).toFixed(0)} % del arranque normal`);
  console.log(fails.length ? 'FALLA: ' + fails.join('; ') : 'OK: entrada por capas');
  process.exit(fails.length ? 1 : 0);
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
