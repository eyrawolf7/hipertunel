// Renderiza sin conexión unos segundos de música + turbina + efectos y guarda WAV y espectrograma.
// Uso: node tests/sonido.mjs [mundo] [nivel] [velocidad m/s] [segundos]
// --espacio: mide la acústica dentro/fuera del tubo (cola, viento, whoomp, energía < 80 Hz).
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
if (process.argv.includes('--espacio')) {
  // acústica: cola de reverberación dentro/fuera, viento, whoomp y energía < 80 Hz frente a un render sin espacio
  const r = await p.evaluate(async () => {
    const { createAudio } = await import('/src/audio/index.js');
    const sr = 44100, secs = 3.2;
    let sd = 7; Math.random = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };   // ruido de los efectos reproducible
    const go = async (kind, sfx) => {
      sd = 7;   // mismo ruido en cada render: la diferencia con «sin espacio» es solo el espacio
      const ctx = new OfflineAudioContext(1, sr * secs, sr);
      const a = createAudio({ context: ctx, noSpace: kind === 'none' });
      a.unlock(); a.setMusic(false); a.setSpace(kind === 'outside');
      if (sfx) a.play(sfx, { delay: 0.6 });
      const d = (await ctx.startRendering()).getChannelData(0);
      const rms = (a0, b0) => { let q = 0; for (let i = a0 * sr | 0; i < b0 * sr; i++) q += d[i] * d[i]; return Math.sqrt(q / ((b0 - a0) * sr)); };
      const low = (f0, f1) => { let e = 0; for (let f = f0; f <= f1; f += 5) { let re = 0, im = 0; const w = 2 * Math.PI * f / sr; for (let i = 0; i < d.length; i += 2) { const h = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / d.length); re += h * d[i] * Math.cos(w * i); im += h * d[i] * Math.sin(w * i); } e += re * re + im * im; } return e / d.length; };
      return { cola: rms(0.75, 1.15), viento: rms(2.0, 3.0), whoomp: rms(0.02, 0.12), graves: low(20, 80), pico: d.reduce((m, v) => Math.max(m, Math.abs(v)), 0) };
    };
    const out = {};
    for (const k of ['none', 'inside', 'outside']) for (const s of ['crash', 'coin', null]) out[k + '/' + (s || 'silencio')] = await go(k, s);
    return out;
  });
  for (const [k, v] of Object.entries(r)) console.log(k.padEnd(18), Object.entries(v).map(([a, b]) => `${a} ${b.toExponential(2)}`).join('  '));
  const ok = (c, m) => { console.log((c ? 'OK   ' : 'FALLA'), m); if (!c) process.exitCode = 1; };
  // la cola del efecto = RMS 0,15-0,55 s después del golpe, sin el viento que haya de fondo
  const cola = (k, s) => Math.sqrt(Math.max(0, r[k + '/' + s].cola ** 2 - r[k + '/silencio'].cola ** 2));
  for (const s of ['crash']) {   // 'coin' suena demasiado tiempo: su propia cola tapa la del espacio
    const ci = cola('inside', s), co = cola('outside', s), cn = cola('none', s);
    ok(ci > co * 1.5, `${s}: la cola dentro (${ci.toExponential(2)}) > fuera (${co.toExponential(2)})`);
    ok(ci > cn * 1.5 + 1e-6, `${s}: dentro hay eco frente a sin espacio (${cn.toExponential(2)})`);
    for (const k of ['inside', 'outside']) {
      const nuevo = r[k + '/' + s].graves - r['none/' + s].graves;
      // lo que cambia es el efecto original al pasar por el compresor con más señal encima: se admite un 6 % de su propio grave
      ok(nuevo < Math.max(1e-5, 0.06 * r['none/' + s].graves), `${s}: ${k} añade ${nuevo.toExponential(2)} de energía < 80 Hz (el efecto solo ya tiene ${r['none/' + s].graves.toExponential(2)}; límite 6 %)`);
    }
  }
  ok(r['outside/silencio'].graves < 1e-5, `viento + whoomp: energía < 80 Hz ${r['outside/silencio'].graves.toExponential(2)} < 1e-5`);
  ok(r['outside/silencio'].viento > 0.004 && r['inside/silencio'].viento < 1e-4, `viento solo fuera (${r['outside/silencio'].viento.toExponential(2)} / ${r['inside/silencio'].viento.toExponential(2)})`);
  ok(r['outside/silencio'].whoomp > r['inside/silencio'].whoomp * 3 && r['outside/silencio'].whoomp > 0.01, `whoomp al salir audible en 0,02-0,12 s, antes de que suba el viento (${r['outside/silencio'].whoomp.toExponential(2)})`);
  console.log('  graves whoomp+viento fuera:', r['outside/silencio'].graves.toExponential(2), 'frente a sin espacio', r['none/silencio'].graves.toExponential(2));
  await b.close();
  process.exit(process.exitCode || 0);
}
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
