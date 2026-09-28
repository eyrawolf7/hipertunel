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
varying vec2 vUv; varying vec4 vWarn; varying vec3 vN; varying vec3 vW; varying vec2 vCell;
void main(){
  vUv = uv; vWarn = aWarn; vN = aN; vCell = aCell;
  vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const frag = /* glsl */`
uniform vec3 uBase; uniform vec3 uBase2; uniform vec3 uSeam; uniform vec3 uFog; uniform vec3 uGlow;
uniform vec3 uCam; uniform vec3 uKey; uniform float uFogNear; uniform float uFogFar; uniform float uTime;
uniform float uInvert; uniform vec2 uCellSize; uniform float uHit; uniform vec3 uRing; uniform float uOutside; uniform vec3 uSkyFill; uniform float uDark;
varying vec2 vUv; varying vec4 vWarn; varying vec3 vN; varying vec3 vW; varying vec2 vCell;
float edgeDist(vec2 uv, vec2 size){ vec2 p = uv * size; vec2 q = min(p, size - p); return min(q.x, q.y); }
void main(){
  vec2 size = uCellSize;
  float d = edgeDist(vUv, size);
  float px = fwidth(d) + 1e-4;
  // junta entre paneles, bisel y subdivisiones finas (el original tiene 2x2 dentro de cada celda)
  float seam = 1.0 - smoothstep(0.02 - px, 0.02 + px, d);
  float bevel = smoothstep(0.03, 0.26, d);
  vec2 sub = abs(fract(vUv * vec2(2.0, 2.0)) - 0.5) * size / 2.0;
  float subD = min(sub.x, sub.y);
  float subL = (1.0 - smoothstep(0.0, 0.008 + px, subD)) * 0.16;
  vec3 N = normalize(vN);
  vec3 V = normalize(uCam - vW);
  float lam = mix(0.6, 0.86, uOutside) + mix(0.4, 0.14, uOutside) * max(dot(N, uKey), 0.0);
  float hemi = 0.5 + 0.5 * N.y;
  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  vec3 base = mix(uBase2, uBase, hemi);
  // un leve degradado a lo largo de cada panel le da volumen, como plástico
  base *= 0.92 + 0.1 * vUv.y;
  vec3 col = base * lam;
  // aviso: color vivo. Apagado si no estás en ese carril, encendido (y brillante) si estás.
  float wa = vWarn.a;
  vec3 warn = vWarn.rgb;
  // apagado = tono pastel del color (se lee de lejos sin gritar); encendido = color puro que emite
  float on = clamp((wa - 0.42) / 0.58, 0.0, 1.0);
  vec3 pastel = mix(warn, vec3(1.0), 0.3) * (0.82 + 0.18 * lam);
  vec3 vivid = warn * (0.85 + 0.15 * lam);
  if (wa > 0.0) col = mix(pastel, vivid, on);
  col += warn * on * 0.38;                            // solo el encendido emite (y da bloom)
  col *= mix(0.78, 1.0, bevel);
  col += 0.1 * (1.0 - bevel) * step(0.5, vUv.x) * (1.0 - clamp(wa * 2.0, 0.0, 1.0));   // brillo del bisel
  col += uSkyFill * 0.14 * max(N.y, 0.0) * uOutside;
  col = mix(col, uSeam, seam);
  col = mix(col, uSeam, subL * (1.0 - clamp(wa * 2.0, 0.0, 1.0) * 0.5));
  // brillo de plástico: un reflejo especular suave que se mueve con la cámara
  vec3 H = normalize(uKey + V);
  col += vec3(1.0) * pow(max(dot(N, H), 0.0), 64.0) * 0.1 * (1.0 - clamp(wa, 0.0, 1.0) * 0.5);
  col += uGlow * fres * 0.25;
  // anillos de luz neutros cada 8 filas, en la junta: pasan zumbando y dan velocidad sin
  // teñir ningún carril (regla 2)
  float ring = (mod(vCell.y, 8.0) < 0.5) ? (1.0 - smoothstep(0.02, 0.16 + px * 2.0, vUv.y * size.y)) : 0.0;
  col = mix(col, uRing * 1.9, ring * 0.85 * (1.0 - uInvert));
  // estado invertido (transición entre mundos): túnel oscuro con juntas de neón
  // mundos oscuros y estado invertido: baldosa azul noche con juntas de luz (como las texturas
  // invertidas del original). El aviso sigue siendo apagado/encendido.
  vec3 neon = mix(uGlow, vec3(1.0), 0.35 + 0.4 * uInvert);
  vec3 inv = vec3(0.075, 0.068, 0.15) * (0.7 + 0.3 * lam) * mix(0.8, 1.0, bevel);
  inv = mix(inv, vec3(0.03, 0.028, 0.06), uInvert);
  if (wa > 0.0) inv = mix(warn * 0.4, warn * 1.1, on) + warn * on * 0.3;
  inv += neon * (seam * 1.25 + subL * 0.45 + ring * 1.0) * (1.0 - clamp(wa * 2.0, 0.0, 1.0) * 0.5);
  inv += vec3(1.0) * pow(max(dot(N, H), 0.0), 64.0) * 0.06;
  col = mix(col, inv, max(uInvert, uDark));
  float dist = length(uCam - vW);
  float fog = smoothstep(uFogNear, uFogFar, dist);
  col = mix(col, uFog, fog);
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
    const idx = new Uint32Array(NQ * 6);
    for (let q = 0; q < NQ; q++) { const v = q * 4; idx.set([v, v + 1, v + 2, v, v + 2, v + 3], q * 6); }
    for (let q = 0; q < NQ; q++) this.uv.set([0, 0, 1, 0, 1, 1, 0, 1], q * 8);
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aN', new THREE.BufferAttribute(this.nrm, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2));
    g.setAttribute('aWarn', new THREE.BufferAttribute(this.warn, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aCell', new THREE.BufferAttribute(this.cell, 2).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    this.uniforms = {
      uBase: { value: new THREE.Color(0xffffff) }, uBase2: { value: new THREE.Color(0xdfe6f5) },
      uSeam: { value: new THREE.Color(0x3a3f5c) }, uFog: { value: new THREE.Color(0xffffff) },
      uGlow: { value: new THREE.Color(0x9fd8ff) }, uCam: { value: new THREE.Vector3() },
      uKey: { value: new THREE.Vector3(0.3, 0.8, 0.5).normalize() },
      uFogNear: { value: 40 }, uFogFar: { value: 118 }, uTime: { value: 0 }, uInvert: { value: 0 },
      uCellSize: { value: new THREE.Vector2(CELL_W, ROW_M) }, uHit: { value: 0 },
      uRing: { value: new THREE.Color(0xfff1c9) }, uDark: { value: 0 }, uOutside: { value: 0 }, uSkyFill: { value: new THREE.Color(0x8fc8ff) },
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
      for (let c = 0; c < LANES; c++, q++) {
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
    a.position.needsUpdate = a.aN.needsUpdate = a.aWarn.needsUpdate = a.aCell.needsUpdate = true;
    this.uniforms.uTime.value += dt;
  }
}
