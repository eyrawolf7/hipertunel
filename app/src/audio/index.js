// Hipertúnel: audio 100 % sintetizado con WebAudio (sin archivos, sin librerías).
// Interfaz: ver docs/CONTRATO.md. Todo es no-op si no hay AudioContext.
//
// Estructura:
//   música ─► musicGain ─► musicFilter (se cierra en las transiciones) ─┐
//   delay (eco de lead/arpegio) ───────────────────────────────────────┤
//   turbina ─► engineGain ─────────────────────────────────────────────┼─► master ─► compresor ─► limitador suave ─► salida
//   efectos ─► sfxGain ────────────────────────────────────────────────┘
//   música y efectos ─► bancos de peines dentro/fuera (setSpace) y viento ─► master

export const MASTER_VOLUME = 0.8;
const MUSIC_VOLUME = 0.5;
const SFX_VOLUME = 0.75;
const ENGINE_VOLUME = 0.35;

// ---------------------------------------------------------------- música
// Cuatro frases de 2 compases (32 semicorcheas), cada una ligada a un acorde
// (grados 0,4,5,3 = I-V-vi-IV en mayor). Las notas son grados de la escala:
// [paso, grado, duración en semicorcheas]. Cada mundo reordena las parejas
// frase+acorde y cambia escala, tonalidad, tempo y timbres: suena a otro tema
// pero la melodía siempre casa con la armonía.
const CHORD_DEG = [0, 4, 5, 3];
const PHRASES = [
  // sobre I: el gancho
  [[0, 4, 2], [2, 4, 1], [3, 5, 1], [4, 4, 2], [6, 2, 2], [8, 0, 2], [10, 2, 2], [12, 4, 4],
   [16, 7, 2], [18, 6, 1], [19, 7, 1], [20, 9, 2], [22, 7, 2], [24, 4, 6], [30, 2, 2]],
  // sobre V: respuesta
  [[0, 4, 2], [2, 6, 2], [4, 8, 3], [7, 6, 1], [8, 4, 2], [10, 6, 2], [12, 8, 4],
   [16, 8, 2], [18, 9, 1], [19, 8, 1], [20, 6, 2], [22, 4, 2], [24, 1, 6], [30, 4, 2]],
  // sobre vi: sube la tensión
  [[0, 5, 2], [2, 5, 1], [3, 7, 1], [4, 9, 2], [6, 7, 2], [8, 5, 2], [10, 4, 2], [12, 5, 4],
   [16, 7, 2], [18, 9, 2], [20, 11, 3], [23, 9, 1], [24, 7, 4], [28, 9, 4]],
  // sobre IV: bajada y vuelta al gancho
  [[0, 10, 3], [3, 9, 1], [4, 7, 2], [6, 5, 2], [8, 7, 2], [10, 9, 2], [12, 7, 4],
   [16, 5, 2], [18, 4, 2], [20, 3, 2], [22, 2, 2], [24, 1, 2], [26, 2, 2], [28, 4, 4]],
];
const PHRASE_MAP = PHRASES.map((ph) => { const m = {}; for (const [s, d, l] of ph) m[s] = [d, l]; return m; });

const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixo: [0, 2, 4, 5, 7, 9, 10],
  minor: [0, 2, 3, 5, 7, 8, 10],
};
// bajo: desplazamiento en semitonos por corchea (8 por compás)
const BASS_PATTERNS = [
  [0, 0, 12, 0, 0, 12, 7, 12],
  [0, 12, 0, 12, 0, 12, 7, 10],
  [0, 0, 7, 0, 12, 0, 7, 5],
];
// Mundos pares 0,2,4,6 → índice 0..3
const WORLDS = [
  { name: 'Pradera', root: 60, scale: 'major', order: [0, 1, 2, 3], bpm: 132, lead: 'square', arp: 'triangle', bass: 0, kick: [0, 4, 8, 12], bell: false },
  { name: 'Neón', root: 62, scale: 'dorian', order: [2, 3, 0, 1], bpm: 136, lead: 'sawtooth', arp: 'square', bass: 1, kick: [0, 4, 8, 12, 14], bell: false },
  { name: 'Cristal', root: 63, scale: 'mixo', order: [3, 0, 1, 2], bpm: 128, lead: 'bell', arp: 'triangle', bass: 2, kick: [0, 6, 8, 12], bell: true },
  { name: 'Volcán', root: 57, scale: 'minor', order: [0, 2, 1, 3], bpm: 140, lead: 'pulse', arp: 'pulse', bass: 1, kick: [0, 4, 8, 12], bell: false },
];

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

// entrada de un mundo nuevo: 5 compases (16 pasos) → 0 silencio, 1 bajo+acordes, 2 bombo, 3 caja+hats+arpegio, 4 melodía
const ENTRY_STEPS = 80;

function degToSemi(scale, d) {
  const o = Math.floor(d / 7);
  return scale[((d % 7) + 7) % 7] + 12 * o;
}

// ---------------------------------------------------------------- no-op
function createNoop() {
  const st = { muted: false };
  return {
    unlock() {}, setMuted(b) { st.muted = !!b; }, get muted() { return st.muted; },
    setMusic() {}, setWorld() {}, setSpeed() {}, setHover() {}, setSpace() {}, setSurface() {}, play() {}, pause() {},
    get available() { return false; },
  };
}

// ---------------------------------------------------------------- principal
export function createAudio(options = {}) {
  const Ctor = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  if (!Ctor && !options.context) return createNoop();

  const state = {
    muted: false, music: true, world: 0, paused: false,
    ms: 0, level: 0, lastSpeedT: -1, outside: false,
    hover: false, hoverSpeed: 0, lastHoverT: -1,
    step: 0, nextTime: 0, transitionT: -10, entrySteps: ENTRY_STEPS,
  };
  let ctx = null, nodes = null, timer = null;
  const offline = !!options.context;

  function safe(fn) {
    return function (...a) { try { return fn.apply(this, a); } catch (e) { if (options.debug) console.warn('[audio]', e); } };
  }

  // ---------- construcción del grafo (perezosa, en el primer gesto)
  function init() {
    if (ctx) return true;
    try { ctx = options.context || new Ctor({ latencyHint: 'interactive' }); } catch (e) { ctx = null; return false; }
    const n = {};
    n.master = ctx.createGain();
    n.master.gain.value = state.muted ? 0 : MASTER_VOLUME;
    n.comp = ctx.createDynamicsCompressor();
    n.comp.threshold.value = -14; n.comp.knee.value = 8; n.comp.ratio.value = 6;
    n.comp.attack.value = 0.003; n.comp.release.value = 0.18;
    // limitador suave: tanh, nunca pasa de 0,95
    n.clip = ctx.createWaveShaper();
    const N = 2048, curve = new Float32Array(N), k = 1.4, nt = Math.tanh(k);
    for (let i = 0; i < N; i++) { const x = (i / (N - 1)) * 2 - 1; curve[i] = 0.95 * Math.tanh(k * x) / nt; }
    n.clip.curve = curve;
    n.master.connect(n.comp); n.comp.connect(n.clip); n.clip.connect(ctx.destination);

    n.musicGain = ctx.createGain(); n.musicGain.gain.value = state.music ? MUSIC_VOLUME : 0;
    n.musicFilter = ctx.createBiquadFilter(); n.musicFilter.type = 'lowpass';
    n.musicFilter.frequency.value = 18000; n.musicFilter.Q.value = 0.7;
    // "ahogo" de la música al chocar con impulso (aparte del filtro de las transiciones)
    n.muffle = ctx.createBiquadFilter(); n.muffle.type = 'lowpass';
    n.muffle.frequency.value = 20000; n.muffle.Q.value = 0.5;
    n.musicGain.connect(n.musicFilter); n.musicFilter.connect(n.muffle); n.muffle.connect(n.master);
    n.music = ctx.createGain(); n.music.connect(n.musicGain); // bus de instrumentos

    // eco (corchea con puntillo) para lead y arpegio
    n.delaySend = ctx.createGain(); n.delaySend.gain.value = 1;
    n.delay = ctx.createDelay(1.0); n.delay.delayTime.value = 0.34;
    n.fb = ctx.createGain(); n.fb.gain.value = 0.3;
    n.dlp = ctx.createBiquadFilter(); n.dlp.type = 'lowpass'; n.dlp.frequency.value = 2400;
    n.delaySend.connect(n.delay); n.delay.connect(n.dlp); n.dlp.connect(n.fb); n.fb.connect(n.delay);
    n.dlp.connect(n.music);

    n.sfx = ctx.createGain(); n.sfx.gain.value = SFX_VOLUME; n.sfx.connect(n.master);
    n.sfxDelay = ctx.createGain(); n.sfxDelay.gain.value = 0.5; n.sfxDelay.connect(n.delay);

    // ruido blanco compartido (2 s)
    const len = Math.floor(ctx.sampleRate * 2);
    n.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = n.noise.getChannelData(0);
    let seed = 12345;
    for (let i = 0; i < len; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; d[i] = (seed / 0x3fffffff) - 1; }

    // ---------- acústica: dos bancos de peines (sin convolución) sobre música y efectos.
    // Dentro del tubo: eco metálico corto y denso. Fuera: pocos ecos lejanos y suaves + viento.
    // Todo pasa por un paso alto (los graves no se tocan) y va a master, no a la turbina.
    if (!options.noSpace) {
      const bank = (delays, fb, hp, lp) => {
        const inG = ctx.createGain(), out = ctx.createGain(); out.gain.value = 0;
        const hpF = ctx.createBiquadFilter(); hpF.type = 'highpass'; hpF.frequency.value = hp;
        inG.connect(hpF);
        for (const dt of delays) {
          const d = ctx.createDelay(0.5); d.delayTime.value = dt;
          const f = ctx.createGain(); f.gain.value = fb;
          const l = ctx.createBiquadFilter(); l.type = 'lowpass'; l.frequency.value = lp;
          hpF.connect(d); d.connect(l); l.connect(f); f.connect(d); l.connect(out);
        }
        out.connect(n.master);
        return { inG, out };
      };
      n.spIn = ctx.createGain(); n.spIn.gain.value = 0.24;
      n.spInside = bank([0.017, 0.023, 0.031], 0.62, 350, 3600);
      n.spOutside = bank([0.09, 0.15], 0.2, 200, 2200);
      n.spInside.out.gain.value = 1;
      n.spIn.connect(n.spInside.inG); n.spIn.connect(n.spOutside.inG);
      n.musicFilter.connect(n.spIn); n.sfx.connect(n.spIn);
      // viento por fuera: ruido paso banda muy bajo que solo suena fuera
      n.wind = ctx.createGain(); n.wind.gain.value = 0; n.wind.connect(n.master);
      n.wSrc = ctx.createBufferSource(); n.wSrc.buffer = n.noise; n.wSrc.loop = true;
      n.wHP = ctx.createBiquadFilter(); n.wHP.type = 'highpass'; n.wHP.frequency.value = 220;
      n.wBP = ctx.createBiquadFilter(); n.wBP.type = 'bandpass'; n.wBP.frequency.value = 650; n.wBP.Q.value = 0.5;
      n.wLfo = ctx.createOscillator(); n.wLfo.frequency.value = 0.22;
      n.wLfoG = ctx.createGain(); n.wLfoG.gain.value = 180;
      n.wLfo.connect(n.wLfoG); n.wLfoG.connect(n.wBP.frequency);
      n.wSrc.connect(n.wHP); n.wHP.connect(n.wBP); n.wBP.connect(n.wind);
      n.wSrc.start(0, 0.7); n.wLfo.start();
    }

    // onda de pulso al 25 %
    const H = 24, re = new Float32Array(H), im = new Float32Array(H);
    for (let h = 1; h < H; h++) im[h] = (2 / (h * Math.PI)) * Math.sin(h * Math.PI * 0.25);
    n.pulse = ctx.createPeriodicWave(re, im);

    // ---------- turbina: ruido filtrado + tono suave (senos, sin armónicos agudos)
    n.engine = ctx.createGain(); n.engine.gain.value = 0; n.engine.connect(n.master);
    n.eNoise = ctx.createBufferSource(); n.eNoise.buffer = n.noise; n.eNoise.loop = true;
    n.eBP = ctx.createBiquadFilter(); n.eBP.type = 'bandpass'; n.eBP.frequency.value = 300; n.eBP.Q.value = 0.8;
    n.eLP = ctx.createBiquadFilter(); n.eLP.type = 'lowpass'; n.eLP.frequency.value = 1800;
    n.eNoiseG = ctx.createGain(); n.eNoiseG.gain.value = 0.3;
    n.eNoise.connect(n.eBP); n.eBP.connect(n.eLP); n.eLP.connect(n.eNoiseG); n.eNoiseG.connect(n.engine);
    n.eTone = ctx.createOscillator(); n.eTone.type = 'sine'; n.eTone.frequency.value = 70;
    n.eTone2 = ctx.createOscillator(); n.eTone2.type = 'sine'; n.eTone2.frequency.value = 105;
    n.eToneG = ctx.createGain(); n.eToneG.gain.value = 0.25;
    n.eTone2G = ctx.createGain(); n.eTone2G.gain.value = 0.08;
    n.eTone.connect(n.eToneG); n.eTone2.connect(n.eTone2G);
    n.eToneG.connect(n.engine); n.eTone2G.connect(n.engine);
    // vaivén lento del filtro: "whoosh" que respira, no zumbido
    n.eLfo = ctx.createOscillator(); n.eLfo.frequency.value = 0.35;
    n.eLfoG = ctx.createGain(); n.eLfoG.gain.value = 60;
    n.eLfo.connect(n.eLfoG); n.eLfoG.connect(n.eBP.frequency);
    n.eNoise.start(); n.eTone.start(); n.eTone2.start(); n.eLfo.start();

    // ---------- tabla flotante (modo Zorro): dos senos graves con trémolo lento
    // y un brillo cristalino tenue (quinta, senos puros) que sube con la velocidad.
    // Va muy por debajo de la turbina; en reposo la ganancia es 0.
    n.hover = ctx.createGain(); n.hover.gain.value = 0; n.hover.connect(n.master);
    n.hTrem = ctx.createGain(); n.hTrem.gain.value = 0.75; n.hTrem.connect(n.hover);
    n.hLfo = ctx.createOscillator(); n.hLfo.frequency.value = 3.2;
    n.hLfoG = ctx.createGain(); n.hLfoG.gain.value = 0.25;
    n.hLfo.connect(n.hLfoG); n.hLfoG.connect(n.hTrem.gain);
    n.hLow = ctx.createOscillator(); n.hLow.type = 'sine'; n.hLow.frequency.value = 88;
    n.hLow2 = ctx.createOscillator(); n.hLow2.type = 'sine'; n.hLow2.frequency.value = 132.6; // quinta, un pelín desafinada: batido suave
    n.hLowG = ctx.createGain(); n.hLowG.gain.value = 0.6;
    n.hLow2G = ctx.createGain(); n.hLow2G.gain.value = 0.3;
    n.hLow.connect(n.hLowG); n.hLow2.connect(n.hLow2G); n.hLowG.connect(n.hTrem); n.hLow2G.connect(n.hTrem);
    n.hGl = ctx.createOscillator(); n.hGl.type = 'sine'; n.hGl.frequency.value = 660;
    n.hGl2 = ctx.createOscillator(); n.hGl2.type = 'sine'; n.hGl2.frequency.value = 990;
    n.hGlG = ctx.createGain(); n.hGlG.gain.value = 0;
    n.hGl.connect(n.hGlG); n.hGl2.connect(n.hGlG); n.hGlG.connect(n.hover);
    // el brillo "centellea" (vaivén lento de amplitud), no es un pitido fijo
    n.hGlLfo = ctx.createOscillator(); n.hGlLfo.frequency.value = 0.7;
    n.hGlLfoG = ctx.createGain(); n.hGlLfoG.gain.value = 0;
    n.hGlLfo.connect(n.hGlLfoG); n.hGlLfoG.connect(n.hGlG.gain);
    n.hLfo.start(); n.hLow.start(); n.hLow2.start(); n.hGl.start(); n.hGl2.start(); n.hGlLfo.start();

    nodes = n;
    applyWorldTiming();
    state.nextTime = ctx.currentTime + 0.1;
    if (!offline && !timer) timer = setInterval(safe(tick), 25);
    return true;
  }

  const W = () => WORLDS[Math.floor(clamp(state.world, 0, 6) / 2)];
  const inTransition = () => state.world % 2 === 1;
  const stepDur = () => 60 / W().bpm / 4;

  function applyWorldTiming() {
    if (!nodes) return;
    nodes.delay.delayTime.setTargetAtTime(stepDur() * 3, ctx.currentTime, 0.05);
  }

  // ---------- utilidades de síntesis
  function osc(type, f, t, dest) {
    const o = ctx.createOscillator();
    if (type === 'pulse') o.setPeriodicWave(nodes.pulse); else o.type = type;
    o.frequency.setValueAtTime(f, t);
    o.connect(dest);
    return o;
  }
  function envGain(t, a, peak, dur, dest, curve = 'exp') {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    if (curve === 'exp') g.gain.exponentialRampToValueAtTime(0.0001, t + a + dur);
    else g.gain.linearRampToValueAtTime(0, t + a + dur);
    g.connect(dest);
    return g;
  }
  // nota con envolvente ADSR sencilla (sostiene y suelta)
  function note(type, f, t, len, peak, dest, { a = 0.005, rel = 0.08, sus = 0.6, cutoff = 0, q = 1, detune = 0 } = {}) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.setTargetAtTime(peak * sus, t + a, 0.08);
    g.gain.setTargetAtTime(0.0001, t + len, rel / 3);
    let out = g;
    if (cutoff) {
      const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = cutoff; fl.Q.value = q;
      g.connect(fl); out = fl;
    }
    out.connect(dest);
    const o = osc(type, f, t, g);
    if (detune) o.detune.value = detune;
    o.start(t); o.stop(t + len + rel + 0.05);
    return o;
  }
  function noiseHit(t, dur, peak, dest, type, f0, f1, q = 1, a = 0.002) {
    const s = ctx.createBufferSource(); s.buffer = nodes.noise;
    const fl = ctx.createBiquadFilter(); fl.type = type; fl.Q.value = q;
    fl.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) fl.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = envGain(t, a, peak, dur, dest);
    s.connect(fl); fl.connect(g);
    s.start(t, Math.random() * 1.5); s.stop(t + a + dur + 0.05);
    return g;
  }
  function sweep(type, f0, f1, t, dur, peak, dest, a = 0.005) {
    const g = envGain(t, a, peak, dur, dest);
    const o = osc(type, f0, t, g);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + a + dur);
    o.start(t); o.stop(t + a + dur + 0.05);
    return o;
  }

  // ---------- batería
  function kick(t, v = 1) {
    const g = envGain(t, 0.002, 0.55 * v, 0.28, nodes.music);
    const o = osc('sine', 150, t, g);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    o.start(t); o.stop(t + 0.35);
  }
  function snare(t, v = 1) {
    noiseHit(t, 0.16, 0.22 * v, nodes.music, 'bandpass', 1900, 1500, 0.9);
    const g = envGain(t, 0.001, 0.12 * v, 0.08, nodes.music);
    const o = osc('triangle', 210, t, g); o.frequency.exponentialRampToValueAtTime(150, t + 0.08);
    o.start(t); o.stop(t + 0.12);
  }
  function hat(t, open, v = 1) {
    noiseHit(t, open ? 0.18 : 0.035, (open ? 0.05 : 0.06) * v, nodes.music, 'highpass', 7500, 0, 0.7);
  }

  // ---------- secuenciador (programación con adelanto)
  function scheduleStep(s, t) {
    const w = W(), sc = SCALES[w.scale], sd = stepDur();
    const lvl = state.level, trans = inTransition();
    const bar = Math.floor(s / 16), inBar = s % 16;
    const chordSlot = Math.floor(s / 32) % 4;
    const phrase = w.order[chordSlot];
    const cdeg = CHORD_DEG[phrase];
    const bright = [0.5, 0.65, 0.82, 1][lvl] || 0.5;
    const es = state.entrySteps, ent = Math.floor(es / 16); // capas ya entradas (5 = todas)
    if (ent < 1) return; // primer compás: solo la turbina

    // batería
    if (ent < 2) { /* aún sin batería */ } else if (trans) {
      // redoble que acelera durante la transición
      const el = ctx.currentTime - state.transitionT;
      if (inBar % 4 === 0) kick(t, 0.8);
      const every = el > 1.6 ? 1 : el > 0.8 ? 2 : 4;
      if (s % every === 0) snare(t, 0.35 + Math.min(0.5, el * 0.2));
    } else {
      if (w.kick.includes(inBar)) kick(t);
      if ((inBar === 4 || inBar === 12) && ent >= 3) snare(t);
      if (bar % 8 === 7 && lvl >= 1 && ent >= 3 && (inBar === 13 || inBar === 14 || inBar === 15)) snare(t, 0.6);
      if (lvl >= 1 && ent >= 3) {
        if (inBar % 4 === 2) hat(t, lvl >= 3, 1);
        else if (lvl >= 2 && inBar % 2 === 1) hat(t, false, 0.55);
        else if (lvl >= 2 && inBar % 4 === 0) hat(t, false, 0.4);
      }
    }

    // bajo (corcheas)
    if (s % 2 === 0) {
      const pat = BASS_PATTERNS[w.bass];
      const off = trans ? 0 : pat[(s / 2) % 8];
      const m = w.root - 24 + degToSemi(sc, cdeg) + off;
      note('sawtooth', mtof(m), t, sd * 1.6, 0.16, nodes.music,
        { cutoff: 380 + 1000 * bright, q: 3, sus: 0.5, rel: 0.05 });
    }

    // colchón de acordes: cada 2 compases, dos voces desafinadas
    if (s % 32 === 0 || es === 16) {
      for (const k of [0, 2, 4]) {
        const m = w.root - 12 + degToSemi(sc, cdeg + k);
        const len = sd * (31 - s % 32);
        note('sawtooth', mtof(m), t, len, 0.028, nodes.music, { a: 0.25, sus: 0.8, rel: 0.4, cutoff: 700 + 1200 * bright, detune: -7 });
        note('triangle', mtof(m), t, len, 0.04, nodes.music, { a: 0.25, sus: 0.8, rel: 0.4, detune: 7 });
      }
    }

    // arpegio (nivel 1+)
    if (lvl >= 1 && !trans && ent >= 3) {
      const seq = [0, 2, 4, 7, 4, 2, 4, 7];
      const d = cdeg + seq[s % 8] + (Math.floor(s / 8) % 2 ? 7 : 0);
      const m = w.root + degToSemi(sc, d);
      const g = note(w.arp, mtof(m), t, sd * 0.5, 0.035, nodes.music, { sus: 0.3, rel: 0.05, cutoff: 1500 + 2500 * bright });
      void g;
      if (s % 4 === 0) note(w.arp, mtof(m), t, sd * 0.5, 0.012, nodes.delaySend, { sus: 0.3, rel: 0.05, cutoff: 2000 });
    }

    // melodía (nivel 2+)
    const ev = PHRASE_MAP[phrase][s % 32];
    if (ev && lvl >= 2 && !trans && ent >= 4) {
      const [d, l] = ev;
      const m = w.root + degToSemi(sc, d);
      const len = l * sd * 0.92;
      const vol = 0.085;
      if (w.bell) {
        note('sine', mtof(m + 12), t, len, vol * 1.1, nodes.music, { sus: 0.35, rel: 0.25 });
        note('sine', mtof(m + 24), t, len * 0.5, vol * 0.25, nodes.music, { sus: 0.1, rel: 0.1 });
      } else {
        const o = note(w.lead, mtof(m), t, len, vol, nodes.music, { sus: 0.75, rel: 0.07, cutoff: 1800 + 3200 * bright, q: 1.5 });
        if (l >= 4) { // vibrato suave en notas largas
          const lfo = ctx.createOscillator(); lfo.frequency.value = 5.5;
          const lg = ctx.createGain(); lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(12, t + len);
          lfo.connect(lg); lg.connect(o.detune); lfo.start(t); lfo.stop(t + len + 0.1);
        }
        if (lvl >= 3) note(w.lead === 'sawtooth' ? 'square' : 'triangle', mtof(m + 12), t, len, vol * 0.35, nodes.music, { sus: 0.7, rel: 0.07, cutoff: 5000 });
      }
      note('triangle', mtof(m), t, len, 0.03, nodes.delaySend, { sus: 0.6, rel: 0.07 });
    }
  }

  function scheduleUntil(until) {
    if (!ctx || !nodes) return;
    while (state.nextTime < until) {
      if (options.log) options.log.push({ what: 'step', s: state.step, t: state.nextTime });
      scheduleStep(state.step, state.nextTime);
      if (state.entrySteps < ENTRY_STEPS) state.entrySteps++;
      state.step = (state.step + 1) % 128;
      state.nextTime += stepDur();
    }
  }
  function tick() {
    if (!ctx || !nodes || state.paused || !state.music || state.muted) return;
    const now = ctx.currentTime;
    if (state.nextTime < now - 0.2) state.nextTime = now + 0.05; // pestaña dormida: no ráfaga
    scheduleUntil(now + 0.12);
  }

  // ---------- turbina
  function updateEngine(now) {
    const n = nodes;
    const ms = state.paused ? 0 : state.ms;
    const t = clamp((ms - 18) / 82, 0, 1);
    const on = clamp(ms / 18, 0, 1);
    const tc = 0.12;
    n.engine.gain.setTargetAtTime(ENGINE_VOLUME * on * (0.12 + 0.13 * t), now, tc);
    n.eBP.frequency.setTargetAtTime(260 + 1300 * Math.pow(t, 1.2) + state.level * 90, now, tc);
    n.eLP.frequency.setTargetAtTime(900 + 2200 * t, now, tc);
    n.eNoiseG.gain.setTargetAtTime(0.35 + 0.4 * t, now, tc);
    n.eTone.frequency.setTargetAtTime(62 + 118 * t, now, tc);
    n.eTone2.frequency.setTargetAtTime((62 + 118 * t) * 1.5, now, tc);
    n.eToneG.gain.setTargetAtTime(0.22 + 0.1 * t, now, tc);
  }

  // ---------- tabla flotante
  const HOVER_VOLUME = 0.02;
  function updateHover(now, toggled) {
    const n = nodes;
    const on = state.hover && !state.paused;
    const v = clamp(state.hoverSpeed, 0, 1);
    const tc = toggled ? (on ? 0.12 : 0.25) : 0.1; // encendido rápido, apagado con fundido
    n.hover.gain.setTargetAtTime(on ? HOVER_VOLUME * (0.8 + 0.2 * v) : 0, now, tc);
    n.hLow.frequency.setTargetAtTime(84 + 24 * v, now, 0.15);
    n.hLow2.frequency.setTargetAtTime((84 + 24 * v) * 1.506, now, 0.15);
    n.hLfo.frequency.setTargetAtTime(2.6 + 2.4 * v, now, 0.2);
    const g = 0.02 + 0.09 * v; // brillo: casi nada parado, algo más a tope
    n.hGlG.gain.setTargetAtTime(g, now, 0.15);
    n.hGlLfoG.gain.setTargetAtTime(g * 0.6, now, 0.15);
    n.hGl.frequency.setTargetAtTime(620 + 260 * v, now, 0.15);
    n.hGl2.frequency.setTargetAtTime((620 + 260 * v) * 1.5, now, 0.15);
  }

  // Primer paso de la rejilla de la música (un paso = semicorchea) en o después de `t`.
  // Los pasos ya programados están hacia atrás desde nextTime; los siguientes, hacia delante.
  function nextGridTime(t) {
    const sd = stepDur();
    const k = Math.ceil((t - state.nextTime) / sd - 1e-6);
    return state.nextTime + k * sd;
  }
  const musicRuns = () => state.music && !state.paused && !state.muted && state.nextTime > ctx.currentTime - 0.2;

  // segundos entre golpes del roce por superficie (a velocidad media): piedra, cristal, musgo, lava, hielo
  const ROLL_GAP = [[0.26, 0.36], [0.22, 0.36], [0.3, 0.42], [0.4, 0.7], [0.8, 1.0]];

  // ---------- efectos
  const SFX = {
    boost(t, o) {
      const L = clamp(o.level || 1, 1, 3), up = Math.pow(2, (L - 1) * 3 / 12);
      noiseHit(t, 0.45, 0.3, nodes.sfx, 'bandpass', 400 * up, 3500 * up, 1.2, 0.02);
      sweep('triangle', 220 * up, 880 * up, t, 0.3, 0.18, nodes.sfx, 0.01);
      const base = 72 + (L - 1) * 3;
      // nivel 3: la última nota del remate cae en el siguiente paso de la música
      let t0 = t + 0.12;
      if (L === 3 && musicRuns()) t0 = nextGridTime(t0 + 3 * 0.045) - 3 * 0.045;
      if (options.log && L === 3) options.log.push({ what: 'remate', t: t0 + 3 * 0.045 });
      unmuffle(t);
      [0, 4, 7, 12].forEach((iv, i) => {
        const tt = t0 + i * 0.045;
        note('square', mtof(base + iv), tt, 0.05, 0.06, nodes.sfx, { sus: 0.4, rel: 0.12, cutoff: 5000 });
        note('sine', mtof(base + iv + 12), tt, 0.05, 0.05, nodes.sfxDelay, { sus: 0.4, rel: 0.15 });
      });
    },
    // solo para pruebas (con options.log): ahoga o abre la música sin sumar ningún otro sonido
    muffle(t, o) { if (!options.log) return; if (o.open) unmuffle(t); else muffle(t, o.hold || 0.5); },
    crash(t) {
      noiseHit(t, 0.28, 0.4, nodes.sfx, 'lowpass', 3000, 300, 0.8);
      noiseHit(t, 0.12, 0.2, nodes.sfx, 'bandpass', 1400, 900, 2);
      sweep('square', 160, 55, t, 0.18, 0.12, nodes.sfx);
      sweep('sine', 110, 40, t, 0.25, 0.4, nodes.sfx);
      duck(0.6, 0.4);
      muffle(t, 0.5);
    },
    death(t) {
      sweep('sine', 130, 28, t, 0.7, 0.7, nodes.sfx);
      noiseHit(t, 1.0, 0.45, nodes.sfx, 'lowpass', 4000, 150, 0.7);
      const g = envGain(t + 0.08, 0.02, 0.14, 1.3, nodes.sfx);
      const fl = ctx.createBiquadFilter(); fl.type = 'lowpass';
      fl.frequency.setValueAtTime(1500, t); fl.frequency.exponentialRampToValueAtTime(150, t + 1.4);
      fl.connect(g);
      const o = osc('sawtooth', 440, t + 0.08, fl);
      o.frequency.exponentialRampToValueAtTime(55, t + 1.4);
      o.start(t + 0.08); o.stop(t + 1.5);
      duck(0.15, 2.0);
    },
    foldStart(t) {
      for (let i = 0; i < 5; i++) {
        const tt = t + 0.3 * (1 - Math.pow(0.72, i)) * 2.2;
        note('square', 300 + i * 70, tt, 0.012, 0.07, nodes.sfx, { sus: 0.3, rel: 0.03, cutoff: 2500 });
        noiseHit(tt, 0.03, 0.08, nodes.sfx, 'bandpass', 3000, 0, 3);
      }
      noiseHit(t, 0.9, 0.22, nodes.sfx, 'bandpass', 300, 2500, 1.5, 0.3);
      sweep('sine', 90, 260, t, 0.9, 0.1, nodes.sfx, 0.2);
    },
    foldEnd(t) {
      sweep('sine', 100, 40, t, 0.3, 0.5, nodes.sfx);
      noiseHit(t, 0.15, 0.2, nodes.sfx, 'lowpass', 1500, 300, 0.7);
      const w = W();
      [12, 16, 19, 24, 28].forEach((iv, i) => {
        note('sine', mtof(w.root + iv), t + 0.06 + i * 0.035, 0.04, 0.05, nodes.sfx, { sus: 0.5, rel: 0.4 });
        note('sine', mtof(w.root + iv) * 1.004, t + 0.07 + i * 0.035, 0.04, 0.03, nodes.sfxDelay, { sus: 0.5, rel: 0.4 });
      });
    },
    world(t) {
      const w = WORLDS[Math.floor(clamp(state.world, 0, 6) / 2)];
      [0, 4, 7, 11, 14, 19].forEach((iv, i) => {
        const f = mtof(w.root + 12 + iv), tt = t + i * 0.075;
        note('sine', f, tt, 0.05, 0.1, nodes.sfx, { sus: 0.5, rel: 0.9 });
        note('sine', f * 2.0, tt, 0.03, 0.03, nodes.sfx, { sus: 0.3, rel: 0.4 });
        note('sine', f * 3.01, tt, 0.01, 0.015, nodes.sfx, { sus: 0.2, rel: 0.15 });
        note('triangle', f, tt, 0.05, 0.04, nodes.sfxDelay, { sus: 0.5, rel: 0.6 });
      });
    },
    coin(t, o) {
      const c = Math.min(Math.max(0, o.combo | 0), 12);
      const k = Math.pow(2, c / 12);
      note('square', 988 * k, t, 0.06, 0.07, nodes.sfx, { sus: 0.9, rel: 0.01, cutoff: 6000 });
      note('square', 1319 * k, t + 0.065, 0.05, 0.07, nodes.sfx, { sus: 0.5, rel: 0.3, cutoff: 6000 });
    },
    menuMove(t) { note('triangle', 880, t, 0.03, 0.12, nodes.sfx, { sus: 0.5, rel: 0.04 }); },
    menuOk(t) {
      note('square', 660, t, 0.04, 0.06, nodes.sfx, { sus: 0.7, rel: 0.03, cutoff: 4000 });
      note('square', 990, t + 0.06, 0.07, 0.06, nodes.sfx, { sus: 0.6, rel: 0.1, cutoff: 4000 });
    },
    menuBack(t) {
      note('square', 660, t, 0.04, 0.05, nodes.sfx, { sus: 0.7, rel: 0.03, cutoff: 3000 });
      note('square', 440, t + 0.06, 0.07, 0.05, nodes.sfx, { sus: 0.6, rel: 0.08, cutoff: 3000 });
    },
    countdown(t) {
      note('square', 440, t, 0.14, 0.08, nodes.sfx, { sus: 0.8, rel: 0.05, cutoff: 3500 });
      note('sine', 880, t, 0.14, 0.05, nodes.sfx, { sus: 0.8, rel: 0.05 });
    },
    go(t) {
      [0, 4, 7].forEach((iv) => note('square', mtof(81 + iv), t, 0.4, 0.05, nodes.sfx, { sus: 0.8, rel: 0.2, cutoff: 5000 }));
      note('sine', mtof(93), t, 0.4, 0.06, nodes.sfx, { sus: 0.7, rel: 0.25 });
      noiseHit(t, 0.4, 0.1, nodes.sfx, 'bandpass', 800, 4000, 1, 0.02);
    },
    record(t) {
      const r = 72;
      const seq = [[0, 0, 0.09], [4, 0.1, 0.09], [7, 0.2, 0.09], [12, 0.3, 0.2], [7, 0.55, 0.09], [12, 0.65, 0.6]];
      for (const [iv, dt, len] of seq) {
        note('square', mtof(r + iv), t + dt, len, 0.06, nodes.sfx, { sus: 0.7, rel: 0.1, cutoff: 5000 });
        note('triangle', mtof(r + iv - 12), t + dt, len, 0.08, nodes.sfx, { sus: 0.7, rel: 0.1 });
      }
      [0, 4, 7, 12].forEach((iv) => note('sine', mtof(r + 12 + iv), t + 0.65, 0.6, 0.03, nodes.sfxDelay, { a: 0.02, sus: 0.7, rel: 0.4 }));
      duck(0.4, 1.4);
    },
    // Aventura: la losa cruje (o = { k: 0..1 } fuerza del desgaste) y se hunde
    creak(t, o = {}) {
      const k = Math.max(0.2, Math.min(1, o.k ?? 0.5));
      noiseHit(t, 0.12, 0.1 * k, nodes.sfx, 'bandpass', 420 + 300 * k, 260, 3, 0.005);
      sweep('sawtooth', 150 + 60 * k, 90, t, 0.1, 0.03 * k, nodes.sfx, 0.004);
    },
    collapse(t) {
      noiseHit(t, 0.5, 0.3, nodes.sfx, 'lowpass', 900, 120, 0.8, 0.005);
      sweep('sine', 180, 45, t, 0.45, 0.12, nodes.sfx, 0.005);
    },
    // ---------- modo Zorro
    // salto: soplo corto que sube + "pling" cristalino ascendente (~0,3 s)
    jump(t) {
      noiseHit(t, 0.2, 0.2, nodes.sfx, 'bandpass', 500, 2600, 1.3, 0.025);
      sweep('sine', 170, 420, t, 0.14, 0.12, nodes.sfx, 0.01);
      sweep('sine', 1047, 1568, t + 0.04, 0.28, 0.075, nodes.sfx, 0.004);
      sweep('sine', 2094, 3136, t + 0.04, 0.1, 0.012, nodes.sfx, 0.004);
      note('sine', 1568, t + 0.1, 0.03, 0.02, nodes.sfxDelay, { sus: 0.4, rel: 0.2 });
    },
    // aterrizaje: golpe grave amortiguado + roce breve (~0,2 s), sin chasquido de choque
    land(t) {
      sweep('sine', 125, 48, t, 0.17, 0.32, nodes.sfx, 0.006);
      noiseHit(t, 0.12, 0.16, nodes.sfx, 'lowpass', 650, 160, 0.7, 0.006);
      noiseHit(t + 0.025, 0.15, 0.045, nodes.sfx, 'bandpass', 1600, 800, 1.6, 0.015);
    },
    // bloque de cartón roto: "crac" en ráfaga, "pop" y campanita de premio (~0,5 s)
    smash(t) {
      const hits = [[0, 0.26, 1300], [0.018, 0.2, 950], [0.04, 0.17, 1500], [0.065, 0.12, 800]];
      for (const [dt, pk, f] of hits) noiseHit(t + dt, 0.05, pk, nodes.sfx, 'bandpass', f, f * 0.6, 1.4, 0.001);
      noiseHit(t, 0.16, 0.18, nodes.sfx, 'lowpass', 900, 200, 0.8, 0.003);
      sweep('sine', 150, 60, t, 0.1, 0.22, nodes.sfx, 0.003);
      sweep('sine', 520, 1100, t + 0.07, 0.05, 0.14, nodes.sfx, 0.002);
      [0, 4, 7, 12].forEach((iv, i) => {
        const tt = t + 0.13 + i * 0.05, f = mtof(79 + iv), last = i === 3;
        note('sine', f, tt, 0.04, 0.075, nodes.sfx, { sus: 0.5, rel: last ? 0.3 : 0.12 });
        note('triangle', f * 2, tt, 0.02, 0.012, nodes.sfx, { sus: 0.3, rel: last ? 0.15 : 0.06 });
        if (last) note('sine', f, tt, 0.04, 0.025, nodes.sfxDelay, { sus: 0.5, rel: 0.3 });
      });
    },
    // golpe al aire: soplo corto (~0,15 s)
    whiff(t) {
      noiseHit(t, 0.12, 0.3, nodes.sfx, 'bandpass', 700, 2200, 1.1, 0.03);
      sweep('sine', 260, 150, t, 0.1, 0.06, nodes.sfx, 0.02);
    },
    // caja que pasa a 1-2 carriles: «fsss» corto paneado hacia su lado (o.pan -1..1, o.near 0..1)
    pass(t, o = {}) {
      const near = clamp(o.near ?? 0.5, 0, 1), side = o.pan < 0 ? -1 : 1;
      const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      let dest = nodes.sfx;
      if (p) { p.pan.value = side * (0.35 + 0.45 * near); p.connect(nodes.sfx); dest = p; }
      noiseHit(t, 0.16, 0.06 + 0.14 * near, dest, 'bandpass', 1500 + 900 * near, 600, 1.1, 0.02);
      sweep('sine', 700 + 300 * near, 330, t, 0.1, 0.02 + 0.03 * near, dest, 0.01);
    },
    nearMiss(t, o = {}) {
      const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      let dest = nodes.sfx;
      if (p) { p.pan.value = o.pan < 0 ? -0.6 : o.pan > 0 ? 0.6 : (Math.random() < 0.5 ? -0.6 : 0.6); p.connect(nodes.sfx); dest = p; }
      noiseHit(t, 0.25, 0.25, dest, 'bandpass', 3200, 700, 1.5, 0.02);
      sweep('sine', 1400, 500, t, 0.15, 0.04, dest, 0.01);
    },
    // roce del suelo bajo la turbina, un golpecito por junta (surface: 0 piedra, 1 cristal, 2 musgo,
    // 3 lava, 4 hielo). Todo tonal y cortito: sin ruido blanco y sin nada por debajo de 80 Hz.
    roll(t, o = {}) {
      const r = Math.random(), v = clamp(o.v ?? 0.5, 0, 1);
      switch (o.surface | 0) {
        case 1:      // cristal: tintineo tonal de ~2,5 kHz, muy suave
          note('sine', 2500 * (0.97 + 0.06 * r), t, 0.05, 0.03, nodes.sfx, { a: 0.002, rel: 0.12, sus: 0.3 });
          note('sine', 3750 * (0.98 + 0.04 * r), t, 0.03, 0.012, nodes.sfx, { a: 0.002, rel: 0.08, sus: 0.3 });
          break;
        case 2:      // musgo: golpe blando y apagado
          sweep('sine', 320 * (0.92 + 0.16 * r), 200, t, 0.06, 0.05, nodes.sfx, 0.012);
          break;
        case 3:      // lava: burbujeo grave
          sweep('sine', 200 + 30 * r, 270 + 50 * r, t, 0.1, 0.06, nodes.sfx, 0.02);
          break;
        case 4: {    // hielo: siseo tonal muy bajo que sube al derrapar (o.slip 0..1)
          const k = 1 + 2.5 * clamp(o.slip ?? 0, 0, 1);
          note('sine', 1800 * (0.97 + 0.06 * r), t, 0.22, 0.006 * k, nodes.sfx, { a: 0.08, rel: 0.16, sus: 0.7 });
          break;
        }
        default:     // piedra: clic suave en la junta
          sweep('sine', 700 * (0.9 + 0.2 * r), 380, t, 0.03, 0.05 * (0.6 + 0.4 * v), nodes.sfx, 0.003);
      }
    },
  };

  function duck(amount, time) {
    const now = ctx.currentTime, g = nodes.musicGain.gain;
    if (!state.music) return;
    g.cancelScheduledValues(now);
    g.setTargetAtTime(MUSIC_VOLUME * amount, now, 0.02);
    g.setTargetAtTime(MUSIC_VOLUME, now + time, 0.3);
  }

  // la música se "ahoga" (paso bajo) al chocar con impulso y se abre sola tras `hold` s
  // o antes, con el siguiente impulso (unmuffle)
  function muffle(t, hold) {
    if (!state.music) return;
    const f = nodes.muffle.frequency;
    f.cancelScheduledValues(t);
    f.setTargetAtTime(380, t, 0.03);
    f.setTargetAtTime(20000, t + hold, 0.18);
    state.muffledUntil = t + hold;
    if (options.log) options.log.push({ what: 'muffle', t, hold });
  }
  function unmuffle(t) {
    if (!(state.muffledUntil > t)) return;
    const f = nodes.muffle.frequency;
    f.cancelScheduledValues(t);
    f.setTargetAtTime(20000, t, 0.06);
    state.muffledUntil = 0;
    if (options.log) options.log.push({ what: 'unmuffle', t });
  }

  function setMusicFilterForWorld() {
    if (!nodes) return;
    const now = ctx.currentTime, f = nodes.musicFilter;
    f.frequency.cancelScheduledValues(now);
    f.Q.cancelScheduledValues(now);
    if (inTransition()) {
      // apagado y "bajo el agua", con un barrido que sube: tensión
      f.frequency.setTargetAtTime(450, now, 0.08);
      f.frequency.setTargetAtTime(2500, now + 0.4, 0.9);
      f.Q.setTargetAtTime(6, now, 0.1);
      // subida de ruido (riser)
      noiseHit(now, 2.6, 0.12, nodes.sfx, 'bandpass', 300, 5000, 4, 1.8);
      const o = sweep('sine', 200, 800, now, 2.4, 0.04, nodes.sfx, 1.8); void o;
    } else {
      f.frequency.setTargetAtTime(18000, now, 0.15);
      f.Q.setTargetAtTime(0.7, now, 0.1);
    }
  }

  function resume() { try { const p = ctx.resume(); if (p && p.catch) p.catch(() => {}); } catch (e) {} }

  // ---------------------------------------------------------------- API
  const api = {
    unlock: safe(function () {
      if (!init()) return;
      if (!offline && ctx.state === 'suspended' && !state.muted) resume();
      // truco de iOS: un búfer mudo desbloquea la salida
      const b = ctx.createBuffer(1, 1, ctx.sampleRate), s = ctx.createBufferSource();
      s.buffer = b; s.connect(ctx.destination); s.start(0);
    }),
    setMuted: safe(function (b) {
      state.muted = !!b;
      if (!ctx) return;
      const now = ctx.currentTime;
      nodes.master.gain.setTargetAtTime(state.muted ? 0 : MASTER_VOLUME, now, 0.03);
      if (!offline) {
        if (state.muted) setTimeout(() => { try { if (state.muted) { const p = ctx.suspend(); if (p && p.catch) p.catch(() => {}); } } catch (e) {} }, 200);
        else if (ctx.state === 'suspended') { resume(); state.nextTime = ctx.currentTime + 0.05; }
      }
    }),
    get muted() { return state.muted; },
    setMusic: safe(function (b) {
      const was = state.music;
      state.music = !!b;
      if (!ctx) return;
      nodes.musicGain.gain.cancelScheduledValues(ctx.currentTime);
      nodes.musicGain.gain.setTargetAtTime(state.music ? MUSIC_VOLUME : 0, ctx.currentTime, 0.1);
      if (state.music && !was) state.nextTime = ctx.currentTime + 0.05;
    }),
    setWorld: safe(function (i, opts) {
      i = clamp(Math.round(+i || 0), 0, 6);
      if (opts && opts.restart) state.entrySteps = ENTRY_STEPS; // partida nueva: la música suena entera
      if (i === state.world) return;
      const prevBpm = W().bpm, prevWorld = state.world;
      state.world = i;
      state.entrySteps = ENTRY_STEPS;
      if (i % 2 === 1 && ctx) state.transitionT = ctx.currentTime;
      if (!ctx) return;
      if (W().bpm !== prevBpm) applyWorldTiming();
      setMusicFilterForWorld();
      // entrando en un mundo nuevo: la canción arranca desde el gancho, en el siguiente tiempo
      if (i % 2 === 0) state.step = 0;
      // tras el salto entre mundos la melodía entra por capas (un compás en silencio, luego una por compás)
      if (i === prevWorld + 1 && prevWorld % 2 === 1 && !(opts && opts.restart)) state.entrySteps = 0;
    }),
    setSpeed: safe(function (ms, level) {
      state.ms = +ms || 0;
      state.level = clamp(level | 0, 0, 3);
      if (!ctx) return;
      const now = ctx.currentTime;
      if (now - state.lastSpeedT < 0.033 && state.lastSpeedT >= 0) return; // ~30 Hz basta
      state.lastSpeedT = now;
      updateEngine(now);
    }),
    play: safe(function (name, opts) {
      if (!ctx && !init()) return;
      if (state.muted || !SFX[name]) return;
      opts = opts || {};
      SFX[name](ctx.currentTime + 0.005 + (opts.delay || 0), opts);
    }),
    pause: safe(function (b) {
      state.paused = !!b;
      if (!ctx) return;
      const now = ctx.currentTime;
      nodes.musicGain.gain.cancelScheduledValues(now);
      nodes.musicGain.gain.setTargetAtTime(state.paused || !state.music ? 0 : MUSIC_VOLUME, now, 0.08);
      if (!state.paused) state.nextTime = now + 0.08;
      updateEngine(now);
      updateHover(now, true);
    }),
    // modo Zorro: zumbido continuo de la tabla. on: bool, speed01: 0..1. Llamable cada fotograma.
    setHover: safe(function (on, speed01) {
      const was = state.hover;
      state.hover = !!on;
      state.hoverSpeed = clamp(+speed01 || 0, 0, 1);
      if (!ctx) return;
      const now = ctx.currentTime, toggled = was !== state.hover;
      if (!toggled && now - state.lastHoverT < 0.033 && state.lastHoverT >= 0) return;
      state.lastHoverT = now;
      updateHover(now, toggled);
    }),
    // dentro (false) o fuera (true) del tubo: cambia el eco y el viento. Llamable cada fotograma.
    setSpace: safe(function (outside) {
      outside = !!outside;
      if (outside === state.outside || !ctx || !nodes || !nodes.spInside) return;
      state.outside = outside;
      const now = ctx.currentTime;
      const to = (g, v, tc) => { g.cancelScheduledValues(now); g.setValueAtTime(g.value, now); g.setTargetAtTime(v, now, tc); };
      to(nodes.spInside.out.gain, outside ? 0 : 1, outside ? 0.05 : 0.12);
      to(nodes.spOutside.out.gain, outside ? 0.4 : 0, outside ? 0.25 : 0.08);
      to(nodes.spIn.gain, outside ? 0.16 : 0.24, 0.2);
      to(nodes.wind.gain, outside ? 0.018 : 0, outside ? 0.5 : 0.15);
      // «whoomp» de presión al salir: seno breve y ruido grave-medio (todo por encima de 100 Hz)
      if (outside && !state.muted && !state.paused) {
        sweep('sine', 260, 120, now + 0.005, 0.28, 0.07, nodes.sfx, 0.02);
        noiseHit(now + 0.005, 0.35, 0.05, nodes.sfx, 'bandpass', 500, 250, 0.8, 0.03);
      }
    }),
    // roce de la superficie: una vez por fotograma en partida (on = jugando y viva). Cadencia por
    // superficie y velocidad; no suena parado, en pausa ni silenciado.
    setSurface: safe(function (on, surface, speed01, slip) {
      if (!ctx || !on || state.muted || state.paused) { state.rollNext = 0; return; }
      const now = ctx.currentTime, v = clamp(+speed01 || 0, 0, 1);
      if (!state.rollNext) { state.rollNext = now + 0.1; return; }
      if (now < state.rollNext) return;
      const s = surface | 0, g = ROLL_GAP[s] || ROLL_GAP[0];
      SFX.roll(now + 0.005, { surface: s, v, slip });
      state.rollNext = now + (g[0] + Math.random() * (g[1] - g[0])) / (0.7 + 0.6 * v);
    }),
    get available() { return true; },
    // solo para pruebas: programar la música hasta t (OfflineAudioContext)
    _scheduleUntil: safe(function (t) { if (init()) scheduleUntil(t); }),
    get _ctx() { return ctx; },
    get _barDur() { return stepDur() * 16; },
  };
  return api;
}
