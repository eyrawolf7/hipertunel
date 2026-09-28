// Comprobaciones de calidad que ya nos han dado guerra. Ejecuta: npm run check
const G = require('./harness')(); const fail = []; const L = 16, lm = (l) => ((l % L) + L) % L;
const blocked = (l, a, b) => G.byLane[lm(l)].some((o) => o.type === 'block' && o.z < b && o.z + o.len > a);
let cd = 0; G.setStep(() => { cd--; if (cd > 0) return 0; const s = G.s, c = G.lane; if (!blocked(c, s - 1, s + 30)) return 0; for (let k = 1; k < 8; k++) for (const sg of [1, -1]) if (!blocked(c + sg * k, s - 1, s + 30)) { cd = 4; return sg; } return 0; });
// 1) cada partida genera una pista y un orden de mundos distintos
const sig = new Set(); for (let r = 0; r < 3; r++) { G.start(); sig.add(G.cxAt(1000).toFixed(2) + '|' + G.perm().join('')); }
if (sig.size < 3) fail.push('La pista no varía entre partidas');
// 2) las placas de impulso nunca quedan por debajo de las baldosas ni separadas de la carretera
let chord = 1e9, gap = 0;
for (const z0 of [200, 1000, 2500]) { G.start(); G.warp(z0); for (let i = 0; i < 60 * 12; i++) { G.update(1 / 60); if (G.state !== 'play') { G.start(); G.warp(z0); } if (i % 6 === 0) { const c = G.chordGap(); if (c < 1e8) chord = Math.min(chord, c); gap = Math.max(gap, G.padErr()); } } }
if (chord < 0.02) fail.push('Placas por debajo de la baldosa: ' + chord.toFixed(3) + ' m');
if (gap > 0.15) fail.push('Placas separadas de la carretera: ' + gap.toFixed(3) + ' m');
// 3) la dificultad crece de forma constante
const D = [0, 1000, 3000, 6000, 10000].map((z) => G.diffAt(z)); for (let i = 1; i < D.length; i++) if (D[i] <= D[i - 1]) fail.push('La dificultad no crece entre ' + i);
// 4) el giroscopio es un volante analógico: el ángulo no da saltos de carril, da velocidad de
// deslizamiento. Los saltitos de carril rompen la sensación de velocidad.
G.setStep(() => 0); G.start(); const feed = (deg, sec) => { for (let i = 0; i < sec * 60; i++) { const r = deg * Math.PI / 180; G.motion(9.8 * Math.cos(Math.PI / 2 + r), 9.8 * Math.sin(Math.PI / 2 + r)); G.update(1 / 60); } };
// carriles recorridos en un segundo sosteniendo el móvil a X grados (tras calibrar recto)
const porSegundo = (deg) => {
  for (let intento = 0; intento < 10; intento++) {
    G.start(); feed(0, 1.25);
    const ini = G.laneF;
    feed(deg, 1);
    if (G.state === 'play') return Math.abs(G.laneF - ini);
  }
  return null;
};
const v = [2, 6, 10, 15, 22, 35].map(porSegundo);
if (v.some((x) => x === null)) fail.push('No se pudo medir el giroscopio: el jugador muere siempre');
else {
  if (v[0] > 0.2) fail.push('El giroscopio se mueve con el móvil casi recto (2 grados): ' + v[0].toFixed(1) + ' carriles/s, el pulso de la mano ya desviaría');
  if (v[1] < 2.5) fail.push('Con un gesto pequeño (6 grados) apenas desliza: ' + v[1].toFixed(1) + ' carriles/s');
  if (v[2] < 6) fail.push('A 10 grados debería cruzar un carril en menos de 0,2 s, y va a ' + v[2].toFixed(1) + ' carriles/s');
  if (v[5] < 20) fail.push('Con el móvil bien girado no se desliza rápido: ' + v[5].toFixed(1) + ' carriles/s');
  // y la respuesta tiene que crecer de forma continua, sin escalones
  for (let i = 1; i < v.length; i++) if (v[i] <= v[i - 1]) fail.push('El giroscopio no responde de forma progresiva entre ' + [2, 6, 10, 15, 22, 35][i - 1] + ' y ' + [2, 6, 10, 15, 22, 35][i] + ' grados');
}
// El cambio de carril tiene que deslizar, no saltar, y comportarse igual aunque al móvil le bajen
// los fotogramas: una integración ingenua del muelle se vuelve inestable por debajo de 40 fps y
// rebota sin parar, que es exactamente la sensación de ir a saltitos.
for (const fps of [60, 40, 30, 22]) {
  const dt = 1 / fps;
  let paso = 0; G.setStep(() => { const d = paso; paso = 0; return d; });
  G.start(); for (let i = 0; i < Math.round(0.5 * fps); i++) G.update(dt);
  const ini = G.laneF; paso = 1;
  const tray = [];
  for (let i = 0; i < Math.round(1.2 * fps); i++) { G.update(dt); tray.push(G.laneF - ini); }
  const t90 = tray.findIndex((x) => x >= 0.9);
  let rebotes = 0;
  for (let i = 2; i < tray.length; i++) { const u = tray[i] - tray[i - 1], w = tray[i - 1] - tray[i - 2]; if (u * w < 0 && Math.abs(u) > 0.004) rebotes++; }
  if (Math.max(...tray) > 1.08) fail.push('A ' + fps + ' fps el cambio de carril se dispara hasta ' + Math.max(...tray).toFixed(1) + ' carriles');
  else if (rebotes > 1) fail.push('A ' + fps + ' fps el cambio de carril rebota ' + rebotes + ' veces: se siente a saltitos');
  else if (t90 < 0) fail.push('A ' + fps + ' fps el cambio de carril no llega a completarse');
  else if (t90 * dt < 0.03) fail.push('A ' + fps + ' fps el cambio de carril es un salto seco, no desliza');
  else if (t90 * dt > 0.12) fail.push('A ' + fps + ' fps el cambio de carril va más lento que en la v0.31 (0,105 s): ' + (t90 * dt).toFixed(2) + ' s');
  G.setStep(() => 0);
}
// tiene que responder en cuanto giras de verdad, sin retardo: cualquier recentrado del cero
// persigue los giros lentos y hace que no reaccionen nunca.
for (const vel of [8, 15, 40]) {
  let grados = null;
  for (let intento = 0; intento < 10 && grados === null; intento++) {
    G.start(); feed(0, 1.25);
    const l0 = G.laneF; let ang = 0;
    // con un volante analógico la respuesta es que EMPIECE a deslizar, no que complete medio carril
    for (let i = 0; i < 180 && grados === null; i++) { ang += vel / 60; feed(ang, 1 / 60); if (Math.abs(G.laneF - l0) > 0.05) grados = ang; }
    if (G.state !== 'play') grados = null;
  }
  if (grados === null) fail.push('Girando a ' + vel + ' grados por segundo no llega a moverse en 3 s');
  else if (grados > 8) fail.push('Girando a ' + vel + ' grados por segundo hay que girar ' + grados.toFixed(1) + ' grados antes de que se mueva nada');
}
// el cero del giroscopio. Al pulsar Jugar estás tocando la pantalla y recolocando el móvil, así que
// la referencia se toma en mitad de ese movimiento. Si se coge mal, la partida arranca girando sola.
for (const giro of [15, 25, 40]) {
  let mov = null;
  for (let intento = 0; intento < 12 && mov === null; intento++) {
    G.start();
    for (let i = 0; i < 18; i++) feed(giro * (i / 18), 1 / 60);   // recolocando el móvil
    feed(giro, 0.6);                                              // ya quieto, sujetándolo así
    const ini = G.laneF;
    feed(giro, 3);
    if (G.state === 'play') mov = Math.abs(G.laneF - ini);
  }
  if (mov !== null && mov > 1) fail.push('Recolocando el móvil ' + giro + ' grados al empezar, la partida arranca deslizando sola: ' + mov.toFixed(1) + ' carriles en 3 s');
}
// 4d) el carril se tiene que pintar ANTES de que el cubo asome. Si el cubo ya se ve a lo lejos y el
// color llega después, el aviso no avisa de nada: acompaña a algo que ya estabas viendo.
{
  let casos = 0, malos = 0, peor = 1e9;
  for (let rep = 0; rep < 4; rep++) {
    G.start(); G.warp(800 + rep * 2200);
    const visto = new Map();
    for (let i = 0; i < 60 * 15; i++) {
      G.update(1 / 60);
      if (G.state !== 'play') { G.start(); G.warp(800 + rep * 2200); continue; }
      const s = G.s;
      for (const o of G.objs) {
        if (o.type !== 'block') continue;
        if (!visto.has(o)) visto.set(o, { lit: null, vis: null });
        const r = visto.get(o);
        if (r.lit === null && o.lit) r.lit = o.z - s;
        if (r.vis === null && o.vis > 0.02) r.vis = o.z - s;
      }
    }
    for (const [, r] of visto) {
      if (r.lit === null || r.vis === null) continue;
      casos++; const margen = r.lit - r.vis;
      if (margen < peor) peor = margen;
      if (margen <= 0) malos++;
    }
  }
  if (casos < 40) fail.push('No se pudieron medir los avisos: solo ' + casos + ' bloques');
  else if (malos > casos * 0.02) fail.push(malos + ' de ' + casos + ' cubos asoman antes que el aviso de su carril');
}
// 5) el color solo avisa si es raro: con medio túnel pintado deja de significar nada.
// En el original nunca se ven más de 2-4 carriles de color a la vez. Pero tampoco debe quedar
// vacío: la dificultad tiene que seguir creciendo con la distancia.
G.setStep(() => 0);
const pintados = (z) => {
  const m = [];
  for (let rep = 0; rep < 4; rep++) {
    G.start(); G.warp(z);
    for (let i = 0; i < 60 * 10; i++) {
      G.update(1 / 60);
      if (G.state !== 'play') { G.start(); G.warp(z); continue; }
      if (i % 10) continue;
      // el muro de la gominola pinta todos los carriles a propósito: no cuenta como saturación
      if (G.dbg().biome === 'candy') continue;
      const s = G.s; let c = 0;
      for (let l = 0; l < L; l++) for (const o of G.byLane[l]) { if (o.type === 'block' && o.lit && o.z + o.len >= s && o.litFrom <= s + 110) { c++; break; } }
      m.push(c);
    }
  }
  m.sort((a, b) => a - b);
  return { media: m.reduce((p, c) => p + c, 0) / m.length, p90: m[Math.floor(m.length * 0.9)] };
};
const dens = [1200, 6000, 10000].map(pintados);
const densMax = Math.max(...dens.map((d) => d.media));
if (densMax > 5) fail.push('Demasiados carriles pintados de aviso a la vez: ' + densMax.toFixed(1) + ' de media (el color deja de avisar)');
if (Math.max(...dens.map((d) => d.p90)) > 9) fail.push('Ráfagas de avisos demasiado grandes: p90 de ' + Math.max(...dens.map((d) => d.p90)) + ' carriles');
// margen amplio: la pista es aleatoria y esto solo debe saltar ante una regresión de verdad
if (dens[2].media < dens[0].media * 1.1) fail.push('La densidad de obstáculos no crece con la distancia: ' + dens.map((d) => d.media.toFixed(1)).join(' -> '));
if (dens[1].media < 0.8) fail.push('Demasiado vacío: apenas hay obstáculos a 6.000 m');
console.log(fail.length ? 'FALLOS:\n- ' + fail.join('\n- ') : 'Todo OK', JSON.stringify({ chordMin: +chord.toFixed(3), padGapMax: +gap.toFixed(3), diff: D.map((d) => +d.toFixed(2)), avisos: dens.map((d) => +d.media.toFixed(1)) }));
process.exit(fail.length ? 1 : 0);
