// Malla del túnel: 12 celdas por fila, una baldosa por celda, reconstruida cada fotograma a
// partir de los anillos (son 360 baldosas, cuesta nada). El aspecto de panel (bisel, juntas,
// subdivisiones finas como el original) se hace en el sombreador, así es nítido a cualquier
// resolución y no depende de texturas.
import * as THREE from 'three';
import { LANES, ROWS } from '../sim/game.js';
import { section, CELL_W, toWorld } from './track.js';
import { ROW_M } from '../sim/game.js';

const NQ = (ROWS + 4) * LANES;

const vert = /* glsl */`
attribute vec4 aWarn;      // rgb color del aviso, a = intensidad (0 nada, ~0.4 apagado, 1 encendido)
attribute vec3 aN;
attribute vec2 aCell;      // x = carril, y = índice de fila
attribute float aSurf;     // superficie de la fila: 0 piedra, 1 cristal, 2 musgo, 3 lava, 4 hielo
varying vec2 vUv; varying vec4 vWarn; varying vec3 vN; varying vec3 vW; varying vec2 vCell; varying float vSurf;
void main(){
  vUv = uv; vWarn = aWarn; vN = aN; vCell = aCell; vSurf = aSurf;
  vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const frag = /* glsl */`
uniform vec3 uBase; uniform vec3 uBase2; uniform vec3 uSeam; uniform vec3 uFog; uniform vec3 uGlow;
uniform vec3 uCam; uniform vec3 uKey; uniform float uFogNear; uniform float uFogFar; uniform float uTime;
uniform float uInvert; uniform vec2 uCellSize; uniform float uHit; uniform vec3 uRing; uniform float uOutside; uniform vec3 uSkyFill; uniform float uDark; uniform vec3 uInvBase;
uniform vec3 uMoss; uniform float uGaps;
varying vec2 vUv; varying vec4 vWarn; varying vec3 vN; varying vec3 vW; varying vec2 vCell; varying float vSurf;
float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
void main(){
  vec2 size = uCellSize;
  vec2 p = vUv * size;                               // metros dentro de la celda
  float du = min(p.x, size.x - p.x);                 // distancia a la junta larga (entre carriles)
  float dv = min(p.y, size.y - p.y);
  float px = fwidth(du) + 1e-4;
  float camD = length(uCam - vW);
  // Arcos abiertos en las juntas, una fila sí y otra no: se ve el paisaje entre carriles. El
  // centro de cada carril es macizo (se conduce por las 12 caras, como en Boost 2).
  float arch = mod(vCell.y, 2.0) < 1.0 ? sin(clamp(vUv.y, 0.0, 1.0) * 3.14159) : 0.0;
  float gapW = uGaps * (0.02 + 0.36 * pow(arch, 0.45));
  if (du < gapW && dv > 0.12) discard;
  // bloques de piedra tallada: 2 a lo ancho, 4 a lo largo, en hiladas alternas
  const float CH = 0.667;                            // alto de hilada
  float bw = size.x / 3.0;                           // tres bloques a lo ancho
  float course = floor(p.y / CH);
  float xo = p.x + mod(course, 2.0) * bw * 0.5;
  float bx = floor(xo / bw);
  vec2 bl = vec2(fract(xo / bw) * bw, fract(p.y / CH) * CH);
  float gb = min(min(bl.x, bw - bl.x), min(bl.y, CH - bl.y));
  float grout = 1.0 - smoothstep(0.014, 0.014 + px * 2.0, gb);
  // relieve: normal inclinada hacia fuera cerca del borde de cada bloque (canto redondeado) y
  // un poco de rugosidad; da luz y sombra de piedra de verdad
  vec2 toC = vec2(bl.x - bw * 0.5, bl.y - CH * 0.5);
  float edgeK = 1.0 - smoothstep(0.02, 0.12, gb);
  vec2 tilt = normalize(toC + 1e-4) * edgeK * 0.55 + (vec2(vn(p * 6.0), vn(p * 6.0 + 7.3)) - 0.5) * 0.18;
  float blockId = h21(vec2(bx + vCell.x * 7.0, course + vCell.y * 5.0));
  // borde tallado junto al arco o la junta
  float rim = 1.0 - smoothstep(gapW, gapW + 0.07 + px, du);
  vec3 N0 = normalize(vN);
  // base tangente de la celda para inclinar la normal (x a lo ancho, y a lo largo)
  vec3 Tx = normalize(dFdx(vW) * dFdx(p.x) + dFdy(vW) * dFdy(p.x) + 1e-6);
  vec3 Ty = normalize(cross(N0, Tx));
  vec3 N = normalize(N0 + Tx * tilt.x + Ty * tilt.y);
  vec3 V = normalize(uCam - vW);
  float lam = mix(0.55, 0.8, uOutside) + mix(0.5, 0.25, uOutside) * max(dot(N, uKey), 0.0);
  float hemi = 0.5 + 0.5 * N.y;
  vec3 base = mix(uBase2, uBase, hemi) * mix(0.85, 1.0, hemi);
  // piedra: cada bloque un pelín distinto y una mancha suave (poco contraste: se lee a 360 km/h)
  base *= 0.93 + 0.1 * blockId;
  base *= 0.94 + 0.08 * vn(p * 1.7 + vCell.xy * 3.1);
  vec3 col = base * lam;
  // bloque ligeramente abombado: más claro en el centro que en los bordes
  col *= 0.9 + 0.1 * smoothstep(0.0, 0.18, gb);
  // aviso: el carril se vuelve cristal del color de la caja. Apagado = cristal pálido, encendido =
  // cristal vivo que brilla. Las facetas son suaves para no ensuciar la lectura.
  float wa = vWarn.a;
  vec3 warn = vWarn.rgb;
  float on = clamp((wa - 0.42) / 0.58, 0.0, 1.0);
  // facetas de cristal: celdas grandes con aristas claras
  vec2 fq = p * vec2(1.6, 0.9); vec2 fi = floor(fq + vn(p * 0.7) * 0.8);
  float facet = 0.5 + 0.5 * sin(h21(fi) * 6.28 + dot(N, uKey) * 3.0);
  float fedge = 1.0 - smoothstep(0.0, 0.06 + px * 3.0, min(abs(fract(fq.x + vn(p * 0.7) * 0.8) - 0.5), abs(fract(fq.y + vn(p * 0.7) * 0.8) - 0.5)) - 0.44);
  vec3 pastel = mix(warn, vec3(1.0), 0.32) * (0.8 + 0.2 * lam) * (0.9 + 0.12 * facet);
  vec3 vivid = warn * (0.8 + 0.2 * lam) * (0.85 + 0.3 * facet);
  if (wa > 0.0) {
    col = mix(pastel, vivid, on);
    col += warn * on * 0.4;                           // solo el encendido emite (y da bloom)
    col += mix(warn, vec3(1.0), 0.5) * rim * (0.25 + 0.5 * on);   // canto del cristal
    col += mix(warn, vec3(1.0), 0.6) * fedge * (0.12 + 0.25 * on);   // aristas de las facetas
  }
  // juntas entre bloques con musgo; en la piedra, nunca en el cristal del aviso
  float moss = smoothstep(0.45, 0.8, vn(p * 2.3 + vec2(vCell.y * 1.7, vCell.x)));
  vec3 groutC = mix(base * 0.42, uMoss * 0.75, moss * 0.75) * lam;
  col = mix(col, groutC, grout * (1.0 - clamp(wa * 2.0, 0.0, 1.0)));
  // canto tallado del arco: más claro arriba y con musgo que cuelga
  vec3 rimC = mix(base * 1.08, uMoss, smoothstep(0.35, 0.75, vn(p * 3.0 + 11.0)) * 0.6) * lam;
  col = mix(col, rimC, rim * 0.7 * (1.0 - clamp(wa * 2.0, 0.0, 1.0)));
  // grosor del muro: el borde del arco se ve como piedra cortada, oscura por dentro
  float depth = 1.0 - smoothstep(0.0, 0.05 + px, du - gapW);
  col *= mix(0.72, 1.0, smoothstep(0.0, 0.14, du - gapW));
  col = mix(col, base * 0.38 * lam, depth * step(0.001, gapW - 0.021) * (1.0 - clamp(wa * 2.0, 0.0, 1.0)));
  col += uSkyFill * 0.14 * max(N.y, 0.0) * uOutside;
  vec3 H = normalize(uKey + V);
  col += vec3(1.0) * pow(max(dot(N, H), 0.0), 40.0) * 0.06;
  // mundos oscuros (noche bioluminiscente) y fase invertida: piedra oscura con juntas que brillan
  float pulse = 0.65 + 0.9 * smoothstep(0.88, 1.0, fract(vCell.y / 24.0 + uTime * 0.6));
  vec3 neon = mix(uGlow, vec3(1.0), 0.3 + 0.4 * uInvert) * pulse;
  vec3 inv = uInvBase * (0.75 + 0.25 * lam) * (0.9 + 0.2 * blockId) * (0.8 + 0.4 * hemi);
  inv = mix(inv, vec3(0.03, 0.028, 0.06), uInvert);
  if (wa > 0.0) inv = mix(warn * 0.4, warn * 1.1, on) + warn * on * 0.3 + mix(warn, vec3(1.0), 0.5) * rim * 0.4;
  inv += neon * (grout * 0.55 + rim * 0.9) * (1.0 - clamp(wa * 2.0, 0.0, 1.0) * 0.6);
  col = mix(col, inv, max(uInvert, uDark));
  // superficie (agarre del giro): se lee de lejos por el tono de toda la baldosa, nunca con el color
  // de un carril ni con azul; los carriles con aviso no se tocan
  if (vSurf > 0.5) {
    float wk = 1.0 - clamp(wa * 2.0, 0.0, 1.0);
    float sOff = smoothstep(0.1, 0.45, length(cross(normalize(uCam - vW), vec3(0.0, 0.0, 1.0))));   // aprox.: lejos del eje de la vista
    if (vSurf < 1.5) {                                   // cristal: losa pulida gris-cian con destellos fuera del centro
      float sp = pow(vn(p * 8.0 + vec2(uTime * 0.25, 0.0)), 24.0) * sOff;
      col = mix(col, vec3(0.55, 0.78, 0.85) * (0.75 + 0.25 * lam), 0.65 * wk);
      col += vec3(1.0) * (sp * 1.1 + pow(max(dot(N, H), 0.0), 14.0) * 0.3) * wk;
    } else if (vSurf < 2.5) {                            // musgo: verde oscuro húmedo con manchas
      float m = smoothstep(0.3, 0.7, vn(p * 1.3 + vCell.yx * 2.1));
      vec3 mo = mix(vec3(0.22, 0.42, 0.2), vec3(0.1, 0.2, 0.11), m) * (0.6 + 0.5 * lam);
      col = mix(col, mo, 0.88 * wk);
    } else if (vSurf < 3.5) {                            // basalto: gris casi negro con juntas de brasa
      col = mix(col, vec3(0.22, 0.19, 0.19) * (0.7 + 0.5 * blockId) * lam * 0.6, 0.85 * wk);
      float ember = (grout + rim * 0.6) * (0.6 + 0.4 * sin(uTime * 1.5 + vCell.y * 0.7 + vCell.x));
      col += vec3(0.45, 0.06, 0.03) * ember * 0.6 * wk;
    } else {                                             // hielo: blanco lechoso con grietas oscuras
      float cr = 1.0 - smoothstep(0.0, 0.03 + px * 2.0, abs(vn(p * 2.5) - 0.5) * 0.6);
      col = mix(col, vec3(0.85, 0.91, 0.94) * (0.8 + 0.25 * lam), 0.88 * wk);
      col *= 1.0 - 0.6 * cr * wk;
      col += vec3(1.0) * pow(max(dot(N, H), 0.0), 20.0) * 0.4 * wk;
    }
  }
  float fog = smoothstep(uFogNear, uFogFar, camD) * (1.0 - 0.55 * step(0.5, vSurf));
  col = mix(col, uFog, fog);
  col += uGlow * fog * (1.0 - fog) * 0.5 * smoothstep(80.0, 110.0, camD) * (1.0 - uOutside);
  col = mix(col, vec3(1.0, 0.25, 0.3), uHit * 0.35);
  gl_FragColor = vec4(col, 1.0);
}`;

export class Tunnel {
  constructor(scene) {
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(NQ * 4 * 3);
    this.nrm = new Float32Array(NQ * 4 * 3);
    this.uv = new Float32Array(NQ * 4 * 2);
    this.warn = new Float32Array(NQ * 4 * 4);
    this.cell = new Float32Array(NQ * 4 * 2);
    this.surf = new Float32Array(NQ * 4);
    const idx = new Uint32Array(NQ * 6);
    for (let q = 0; q < NQ; q++) { const v = q * 4; idx.set([v, v + 1, v + 2, v, v + 2, v + 3], q * 6); }
    for (let q = 0; q < NQ; q++) this.uv.set([0, 0, 1, 0, 1, 1, 0, 1], q * 8);
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aN', new THREE.BufferAttribute(this.nrm, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2));
    g.setAttribute('aWarn', new THREE.BufferAttribute(this.warn, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aCell', new THREE.BufferAttribute(this.cell, 2).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSurf', new THREE.BufferAttribute(this.surf, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    this.uniforms = {
      uBase: { value: new THREE.Color(0xffffff) }, uBase2: { value: new THREE.Color(0xdfe6f5) },
      uSeam: { value: new THREE.Color(0x3a3f5c) }, uFog: { value: new THREE.Color(0xffffff) },
      uGlow: { value: new THREE.Color(0x9fd8ff) }, uCam: { value: new THREE.Vector3() },
      uKey: { value: new THREE.Vector3(0.3, 0.8, 0.5).normalize() },
      uFogNear: { value: 40 }, uFogFar: { value: 118 }, uTime: { value: 0 }, uInvert: { value: 0 },
      uCellSize: { value: new THREE.Vector2(CELL_W, ROW_M) }, uHit: { value: 0 },
      uRing: { value: new THREE.Color(0xfff1c9) }, uDark: { value: 0 }, uMoss: { value: new THREE.Color(0x5fae3a) }, uGaps: { value: 1 }, uInvBase: { value: new THREE.Color(0x13112a) }, uOutside: { value: 0 }, uSkyFill: { value: new THREE.Color(0x8fc8ff) },
    };
    this.mat = new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, uniforms: this.uniforms, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.laneGlow = new Float32Array(LANES);
    this._v = new THREE.Vector3();
  }

  // colors: array de THREE.Color por índice de color de caja
  update(game, track, colors, dt) {
    const sec = section(game.fold);
    const closed = game.fold === 30 || game.fold === -30;
    const lit = game.litStrips();
    const on = game.playerStrips();
    // brillo de cada carril: sube rápido al entrar y baja algo más despacio (Cell::lightUp/dimDown)
    for (let l = 0; l < LANES; l++) {
      const target = on.includes(l) ? 1 : 0;
      const k = target > this.laneGlow[l] ? 14 : 7;
      this.laneGlow[l] += (target - this.laneGlow[l]) * Math.min(1, k * dt);
    }
    const kNear = Math.floor(game.s) - 2;
    const P = this.pos, N = this.nrm, W = this.warn, C = this.cell, v = this._v;
    let q = 0;
    for (let k = kNear; k <= game.kLast && q < NQ; k++) {
      const ra = track.rings.get(k), rb = track.rings.get(k + 1);
      if (!ra || !rb) continue;
      if (game.inGap(k)) continue;           // carretera cortada: salto entre mundos
      const sf = game.surfaceAt ? game.surfaceAt(k) : 0;
      for (let c = 0; c < LANES; c++, q++) {
        this.surf[q * 4] = this.surf[q * 4 + 1] = this.surf[q * 4 + 2] = this.surf[q * 4 + 3] = sf;
        const b = sec.b, d = sec.d;
        const x0 = b[c * 2], y0 = b[c * 2 + 1], x1 = b[c * 2 + 2], y1 = b[c * 2 + 3];
        const o = q * 12;
        toWorld(ra, x0, y0, v); P[o] = v.x; P[o + 1] = v.y; P[o + 2] = v.z;
        toWorld(ra, x1, y1, v); P[o + 3] = v.x; P[o + 4] = v.y; P[o + 5] = v.z;
        toWorld(rb, x1, y1, v); P[o + 6] = v.x; P[o + 7] = v.y; P[o + 8] = v.z;
        toWorld(rb, x0, y0, v); P[o + 9] = v.x; P[o + 10] = v.y; P[o + 11] = v.z;
        const nx = -d[c * 2 + 1], ny = d[c * 2];
        for (let j = 0; j < 4; j++) {
          const r = j < 2 ? ra : rb;
          v.copy(r.X).multiplyScalar(nx).addScaledVector(r.U, ny);
          N[o + j * 3] = v.x; N[o + j * 3 + 1] = v.y; N[o + j * 3 + 2] = v.z;
        }
        // aviso de esta celda
        let wr = 0, wg = 0, wb = 0, wa = 0;
        const strips = lit.get(c);
        if (strips) {
          let best = null;
          for (const st of strips) if (k >= st.from && k <= st.to && (!best || st.id > best.id)) best = st;
          if (best) { const col = colors[best.color]; wr = col.r; wg = col.g; wb = col.b; wa = 0.42 + 0.58 * this.laneGlow[c]; }
        }
        for (let j = 0; j < 4; j++) {
          const w = q * 16 + j * 4; W[w] = wr; W[w + 1] = wg; W[w + 2] = wb; W[w + 3] = wa;
          C[q * 8 + j * 2] = c; C[q * 8 + j * 2 + 1] = k;
        }
      }
    }
    // baldosas sobrantes: se aplastan
    for (let o = q * 12; o < NQ * 12; o++) P[o] = 0;
    this.geo.setDrawRange(0, q * 6);
    const a = this.geo.attributes;
    a.position.needsUpdate = a.aN.needsUpdate = a.aWarn.needsUpdate = a.aCell.needsUpdate = a.aSurf.needsUpdate = true;
    this.uniforms.uTime.value += dt;
  }
}
