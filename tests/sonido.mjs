// Renderiza sin conexión unos segundos de música + turbina + efectos y guarda WAV y espectrograma.
// Uso: node tests/sonido.mjs [mundo] [nivel] [velocidad m/s] [segundos]
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
const [world = 0, level = 2, speed = 80, secs = 10] = process.argv.slice(2).map(Number);
const dir = new URL('./shots/sonido/', import.meta.url).pathname; mkdirSync(dir, { recursive: true });
const b = await puppeteer.launch({ headless: 'new' });
const p = await b.newPage();
await p.goto('http://localhost:5173/src/audio/demo.html', { waitUntil: 'networkidle0' });
if (process.env.SIN_MUSICA) await p.evaluate(() => { window.__noMusic = true; });
const data = await p.evaluate(async (world, level, speed, secs) => {
  const { createAudio } = await import('/src/audio/index.js');
  const sr = 44100, ctx = new OfflineAudioContext(1, sr * secs, sr);
  const a = createAudio({ context: ctx });
  a.unlock(); a.setMusic(!(window.__noMusic)); a.setWorld(world); a.setSpeed(speed, level);
  a.play('boost', { level: 1, delay: 2 }); a.play('coin', { combo: 2, delay: 4 }); a.play('crash', { delay: 6 });
  a._scheduleUntil(secs);
  const buf = await ctx.startRendering();
  const ch = buf.getChannelData(0); let peak = 0, sum = 0; for (let i = 0; i < ch.length; i++) { const v = Math.abs(ch[i]); if (v > peak) peak = v; sum += v * v; }
  const i16 = new Int16Array(ch.length); for (let i = 0; i < ch.length; i++) i16[i] = Math.max(-1, Math.min(1, ch[i])) * 32767;
  let bin = ''; const u8 = new Uint8Array(i16.buffer); for (let i = 0; i < u8.length; i += 8192) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 8192));
  return { b64: btoa(bin), peak, rms: Math.sqrt(sum / ch.length), sr };
}, world, level, speed, secs);
await b.close();
const pcm = Buffer.from(data.b64, 'base64');
const hdr = Buffer.alloc(44); hdr.write('RIFF', 0); hdr.writeUInt32LE(36 + pcm.length, 4); hdr.write('WAVE', 8); hdr.write('fmt ', 12); hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20); hdr.writeUInt16LE(1, 22); hdr.writeUInt32LE(data.sr, 24); hdr.writeUInt32LE(data.sr * 2, 28); hdr.writeUInt16LE(2, 32); hdr.writeUInt16LE(16, 34); hdr.write('data', 36); hdr.writeUInt32LE(pcm.length, 40);
const wav = `${dir}m${world}-n${level}-v${speed}.wav`; writeFileSync(wav, Buffer.concat([hdr, pcm]));
execSync(`ffmpeg -y -loglevel error -i ${wav} -lavfi showspectrumpic=s=1200x500:legend=1:fscale=log ${wav.replace('.wav', '.png')}`);
console.log(wav, 'pico', data.peak.toFixed(2), 'rms', data.rms.toFixed(3));
