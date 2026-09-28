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
// 4) el giroscopio: una inclinación normal mueve un carril y solo uno, por brusco que sea el sensor
G.setStep(() => 0); G.start(); const feed = (deg, sec) => { for (let i = 0; i < sec * 60; i++) { const r = deg * Math.PI / 180; G.motion(9.8 * Math.cos(Math.PI / 2 + r), 9.8 * Math.sin(Math.PI / 2 + r)); G.update(1 / 60); } };
const dl = (a, b) => ((a - b + 8 + 16) % 16) - 8;   // diferencia de carriles teniendo en cuenta la vuelta al túnel
// moverse mucho hace chocar contra un bloque, y al morir ya no se cambia de carril: se reintenta
// con otra pista hasta conseguir una medida con el jugador vivo.
// Se acumula carril a carril: dando vueltas al túnel, la diferencia entre inicio y final da la
// vuelta y se pierde la cuenta (16 carriles recorridos parecerían 0).
const mover = (deg, sec) => {
  for (let intento = 0; intento < 12; intento++) {
    G.start(); feed(0, 1.1);   // se espera a que termine la calibración inicial del cero
    let prev = G.lane, acc = 0;
    for (let i = 0; i < sec * 60; i++) { feed(deg, 1 / 60); acc += Math.abs(dl(G.lane, prev)); prev = G.lane; }
    if (G.state === 'play') return acc;
  }
  return null;
};
const uno = mover(9, 0.8);   // gesto pequeño: un carril y solo uno
if (uno === null) fail.push('No se pudo medir la inclinación: el jugador muere siempre');
else if (uno === 0) fail.push('La inclinación no cambia de carril');
else if (uno !== 1) fail.push('Una inclinación normal salta ' + uno + ' carriles en vez de 1');
const mantenido = mover(9, 2.5);   // mantener un gesto pequeño NO debe encadenar carriles
if (mantenido !== null && mantenido !== 1) fail.push('Mantener el móvil inclinado encadena carriles solo: ' + mantenido);
// Mantener el móvil girado tiene que dar vueltas rápidas al túnel: es parte de la gracia y de la
// pericia. Ojo al tocar los umbrales: es fácil matar esto sin querer buscando precisión.
const girado = mover(38, 1.0);
if (girado !== null && girado < 8) fail.push('Con el móvil girado no se dan vueltas rápidas: solo ' + girado + ' carriles en 1 s');
// y tiene que responder al momento, no sentirse pesado
let respuesta = null;
for (let intento = 0; intento < 12 && respuesta === null; intento++) {
  G.start(); feed(0, 1.1);
  const l0 = G.lane; let t = 0;
  for (let i = 0; i < 60 && respuesta === null; i++) { feed(12, 1 / 60); t += 1 / 60; if (G.lane !== l0) respuesta = t; }
  if (G.state !== 'play') respuesta = null;
}
if (respuesta === null) fail.push('Una inclinación de 12 grados no llega a mover el carril en 1 s');
else if (respuesta > 0.15) fail.push('El giroscopio responde tarde: ' + respuesta.toFixed(2) + ' s hasta cambiar de carril');
// 4c) tiene que sentirse ágil también girando despacio. Cualquier recentrado del cero persigue los
// giros lentos y hace que no reaccionen nunca, que se siente como un retardo enorme.
for (const vel of [8, 15, 40]) {
  let grados = null;
  for (let intento = 0; intento < 10 && grados === null; intento++) {
    G.start(); feed(0, 1.2);                      // sujetando el móvil recto y quieto
    const l0 = G.lane; let ang = 0;
    for (let i = 0; i < 180 && grados === null; i++) { ang += vel / 60; feed(ang, 1 / 60); if (G.lane !== l0) grados = ang; }
    if (G.state !== 'play') grados = null;
  }
  if (grados === null) fail.push('Girando a ' + vel + ' grados por segundo no llega a cambiar de carril en 3 s');
  else if (grados > 9) fail.push('Girando a ' + vel + ' grados por segundo hay que girar ' + grados.toFixed(1) + ' grados para que reaccione');
}
// 4b) el cero del giroscopio. Al pulsar Jugar estás tocando la pantalla y recolocando el móvil, así
// que la referencia se toma en mitad de ese movimiento. Si se coge mal, la partida arranca girando
// sola. Aquí se recoloca el móvil durante el primer cuarto de segundo y luego se sujeta quieto.
for (const giro of [15, 25, 40]) {
  let mov = null;
  for (let intento = 0; intento < 12 && mov === null; intento++) {
    G.start();
    for (let i = 0; i < 15; i++) feed(giro * (i / 15), 1 / 60);   // recolocando el móvil
    feed(giro, 0.6);                                              // ya quieto, sujetándolo así
    let prev = G.lane, acc = 0;
    for (let i = 0; i < 60 * 3; i++) { feed(giro, 1 / 60); acc += Math.abs(dl(G.lane, prev)); prev = G.lane; }
    if (G.state === 'play') mov = acc;
  }
  if (mov !== null && mov > 1) fail.push('Recolocando el móvil ' + giro + ' grados al empezar, la partida arranca girando sola: ' + mov + ' carriles en 3 s');
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
