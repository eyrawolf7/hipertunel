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
  // paso lateral aislado: pico, duración y parte de la energía por debajo de 80 Hz (filtro RBJ de 2.º orden, dos pasadas)
  solo = solo || {};
  for (const [n, o] of [['pass', { pan: -1, near: 0 }], ['pass', { pan: 1, near: 1 }], ['nearMiss', { pan: 1 }]]) {
    const c5 = new OfflineAudioContext(1, sr * 1.2, sr), a5 = createAudio({ context: c5 });
    a5.unlock(); a5.setMusic(false); a5.play(n, o);
    const d5 = (await c5.startRendering()).getChannelData(0); let pk = 0, e = 0, last = 0;
    for (let i = 0; i < d5.length; i++) { const v = Math.abs(d5[i]); if (v > pk) pk = v; e += v * v; }
    for (let i = 0; i < d5.length; i++) if (Math.abs(d5[i]) > pk * 0.03) last = i;
    const w0 = 2 * Math.PI * 80 / sr, al = Math.sin(w0) / (2 * 0.7071), cs = Math.cos(w0), a0 = 1 + al;
    const b0 = (1 - cs) / 2 / a0, b1 = (1 - cs) / a0, b2 = b0, a1 = -2 * cs / a0, a2 = (1 - al) / a0;
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0, lo = 0;
    for (let i = 0; i < d5.length; i++) { const x = d5[i], y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x; y2 = y1; y1 = y; lo += y * y; }
    solo[`${n} ${JSON.stringify(o)}`] = `pico ${pk.toFixed(3)} dur ${(last / sr).toFixed(2)} s energía<80Hz ${(100 * lo / Math.max(e, 1e-12)).toFixed(2)} %`;
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
