// Cómo se siente el juego, medido: cuánto se avanza antes de morir, a qué velocidad se va,
// cuánto se respira entre obstáculos y cada cuánto llega un impulso.
// Sirve para comparar antes y después de tocar la dificultad.
// Uso: node tests/ritmo.js [minutos] [parámetros tipo url: clave=valor ...]
const args = process.argv.slice(2);
const mins = parseFloat(args[0]) > 0 ? parseFloat(args[0]) : 4;
const params = {};
for (const a of args.slice(1)) { const [k, v] = a.split('='); if (k && v !== undefined) params[k] = v; }
const G = require('./harness')(params);
const L = 16, lm = (l) => ((l % L) + L) % L;

// Bot: se queda en su carril salvo que venga algo; entonces busca el hueco más cercano.
// Prefiere pisar las placas de impulso si le pillan de paso.
let cd = 0;
const bloqueado = (l, a, b) => G.byLane[lm(l)].some((o) => (o.type === 'block' || o.type === 'roller') && o.z < b && o.z + o.len > a);
const hayPlaca = (l, a, b) => G.byLane[lm(l)].some((o) => o.type === 'boost' && o.z < b && o.z + o.len > a);
G.setStep(() => {
  cd--; if (cd > 0) return 0;
  const s = G.s, c = G.lane, vista = Math.max(26, G.dbg ? 30 : 30);
  if (!bloqueado(c, s - 1, s + vista)) {
    for (const sg of [1, -1]) if (hayPlaca(c + sg, s + 2, s + vista) && !bloqueado(c + sg, s - 1, s + vista)) { cd = 5; return sg; }
    return 0;
  }
  for (let k = 1; k < 8; k++) for (const sg of [1, -1]) if (!bloqueado(c + sg * k, s - 1, s + vista)) { cd = 4; return sg; }
  return 0;
});

const dt = 1 / 60, pasos = Math.round(mins * 60 * 60);
let muertes = 0, distTotal = 0, vidaIni = 0, mejorDist = 0, sumaVel = 0, n = 0;
let sinAviso = 0, nivelSuma = 0, avisoSuma = 0, avisoN = 0; const avisoTodos = [], sinCandy = [], picos = {}, franjas = [];
const vidas = [], impulsos = [];
let ultimoNivel = 0, ultimoImpulsoZ = 0;
G.start();
for (let i = 0; i < pasos; i++) {
  G.update(dt);
  if (G.state !== 'play') {
    if (G.s > vidaIni) { vidas.push(G.s - vidaIni); distTotal += G.s - vidaIni; mejorDist = Math.max(mejorDist, G.s - vidaIni); }
    muertes++; G.start(); vidaIni = 0; ultimoNivel = 0; ultimoImpulsoZ = 0; continue;
  }
  const s = G.s;
  sumaVel += G.speed || 0; nivelSuma += G.level; n++;
  if (G.level > ultimoNivel) { if (ultimoImpulsoZ) impulsos.push(s - ultimoImpulsoZ); ultimoImpulsoZ = s; }
  ultimoNivel = G.level;
  if (i % 6 === 0) {
    let avisos = 0; const on = [];
    for (let l = 0; l < L; l++) { let v = false; for (const o of G.byLane[l]) { if (o.type === 'block' && o.lit && o.z + o.len >= s && o.litFrom <= s + 110) { v = true; break; } } on.push(v); if (v) avisos++; }
    // franjas: tramos contiguos de carril pintados. Una franja ancha se lee de un golpe; seis
    // avisos sueltos repartidos por el contorno, no.
    let gr = 0; for (let l = 0; l < L; l++) if (on[l] && !on[lm(l - 1)]) gr++;
    if (avisos === L) gr = 1;
    franjas.push(gr);
    if (avisos === 0) sinAviso++;
    avisoSuma += avisos; avisoN++; avisoTodos.push(avisos);
    const bk = G.dbg().biome; if (bk !== 'candy') { sinCandy.push(avisos); } if (avisos >= 12) picos[bk] = (picos[bk] || 0) + 1;
  }
}
if (G.state === 'play' && G.s > vidaIni) vidas.push(G.s - vidaIni);
const media = (a) => (a.length ? a.reduce((p, c) => p + c, 0) / a.length : 0);
vidas.sort((a, b) => a - b);
console.log(JSON.stringify(params) === '{}' ? '(valores actuales)' : JSON.stringify(params));
console.log('  minutos jugados      ', mins);
console.log('  muertes              ', muertes, '(' + (muertes / mins).toFixed(1) + ' por minuto)');
console.log('  distancia por vida   ', Math.round(media(vidas)) + ' m   mediana ' + Math.round(vidas[vidas.length >> 1] || 0) + ' m   mejor ' + Math.round(mejorDist) + ' m');
console.log('  velocidad media      ', (sumaVel / n).toFixed(1) + ' m/s');
console.log('  nivel de impulso medio', (nivelSuma / n).toFixed(2));
console.log('  un impulso cada      ', impulsos.length ? Math.round(media(impulsos)) + ' m' : '(ninguno encadenado)');
avisoTodos.sort((a, b) => a - b);
console.log('  carriles pintados a la vez', (avisoSuma / avisoN).toFixed(1) + ' de media   p90 ' + avisoTodos[Math.floor(avisoN * 0.9)] + '   pico ' + avisoTodos[avisoN - 1]);
sinCandy.sort((a, b) => a - b);
console.log('  sin contar el caramelo    ', (sinCandy.reduce((p, c) => p + c, 0) / sinCandy.length).toFixed(1) + ' de media   p90 ' + sinCandy[Math.floor(sinCandy.length * 0.9)] + '   pico ' + sinCandy[sinCandy.length - 1]);
franjas.sort((a, b) => a - b);
console.log('  franjas de aviso a la vez ', (franjas.reduce((p, c) => p + c, 0) / franjas.length).toFixed(1) + ' de media   p90 ' + franjas[Math.floor(franjas.length * 0.9)]);
console.log('  momentos con 12+ carriles ', JSON.stringify(picos));
