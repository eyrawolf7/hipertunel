// Placas de impulso: la celda entera en azul eléctrico con chevrones blancos que corren hacia
// delante, y por delante un rastro de 6 celdas con flechas cada vez más tenues, como el original.
// Van planas y pegadas a la carretera (regla 3: azul = impulso y solo impulso).
import * as THREE from 'three';
import { ROW_M } from '../sim/game.js';
import { section, surf, CELL_W, makeFrame } from './track.js';

const MAX = 4 * 7 * 6;

const vert = /* glsl */`
attribute float aAlpha; attribute float aMain;
varying vec2 vUv; varying float vAlpha; varying float vMain;
void main(){ vUv = uv; vAlpha = aAlpha; vMain = aMain;
  gl_Position = projectionMatrix * viewMatrix * instanceMatrix * vec4(position, 1.0); }`;
const frag = /* glsl */`
uniform float uTime; varying vec2 vUv; varying float vAlpha; varying float vMain;
float chev(vec2 p){ // chevrón apuntando hacia v creciente
  float y = fract(p.y * 2.0 - uTime * 2.4);
  float x = abs(p.x - 0.5);
  float d = abs(y - 0.35 - x * 0.9);
  return 1.0 - smoothstep(0.07, 0.11, d);
}
void main(){
  vec2 uv = vUv;
  vec2 q = abs(uv - 0.5);
  float border = smoothstep(0.5, 0.44, max(q.x, q.y));
  float c = chev(uv) * smoothstep(0.46, 0.34, q.x);
  vec3 blue = mix(vec3(0.02, 0.2, 1.0), vec3(0.08, 0.72, 1.0), uv.y);
  vec3 col = mix(blue, vec3(1.0), c);
  float a = vMain > 0.5 ? border : c * vAlpha;
  vec3 outc = vMain > 0.5 ? col * 1.6 + vec3(1.0) * c * 1.2 : vec3(0.3, 0.7, 1.0) * 1.5;
  if (a < 0.01) discard;
  gl_FragColor = vec4(outc, a);
}`;

export class Pads {
  constructor(scene) {
    const g = new THREE.PlaneGeometry(1, 1);
    g.rotateX(-Math.PI / 2);           // plano XZ; v crece hacia -Z (adelante)
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
    this.alpha = new Float32Array(MAX); this.main = new Float32Array(MAX);
    g.setAttribute('aAlpha', new THREE.InstancedBufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aMain', new THREE.InstancedBufferAttribute(this.main, 1).setUsage(THREE.DynamicDrawUsage));
    this.uniforms = { uTime: { value: 0 } };
    this.mat = new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, uniforms: this.uniforms, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide });
    this.mesh = new THREE.InstancedMesh(g, this.mat, MAX);
    this.mesh.frustumCulled = false; this.mesh.count = 0; this.mesh.renderOrder = 2;
    scene.add(this.mesh);
    this.fr = makeFrame(); this.sp = {};
    this.m = new THREE.Matrix4(); this.T = new THREE.Vector3(); this.N = new THREE.Vector3(); this.B = new THREE.Vector3(); this.p = new THREE.Vector3();
  }

  update(game, track, dt) {
    this.uniforms.uTime.value += dt;
    const sec = section(game.fold);
    const closed = game.fold === 30 || game.fold === -30;
    const { fr, sp, m, T, N, B, p } = this;
    let n = 0;
    const put = (sMid, lane, alpha, main) => {
      if (!track.rings.has(Math.floor(sMid)) || !track.rings.has(Math.floor(sMid) + 1) || n >= MAX) return;
      track.frameAt(sMid, fr);
      surf(sec, lane, closed, sp);
      T.copy(fr.X).multiplyScalar(sp.tx).addScaledVector(fr.U, sp.ty);
      N.copy(fr.X).multiplyScalar(-sp.ty).addScaledVector(fr.U, sp.tx);
      B.copy(fr.F).negate();
      p.copy(fr.P).addScaledVector(fr.X, sp.x).addScaledVector(fr.U, sp.y).addScaledVector(N, 0.03 + game.jumpAt(sMid));
      m.makeBasis(T, N, B);
      m.scale(this.T.set(CELL_W * 0.94, 1, ROW_M * 0.94));
      T.copy(fr.X).multiplyScalar(sp.tx).addScaledVector(fr.U, sp.ty);
      m.setPosition(p);
      this.mesh.setMatrixAt(n, m);
      this.alpha[n] = alpha; this.main[n] = main ? 1 : 0;
      n++;
    };
    for (const pd of game.pads) {
      if (pd.taken) continue;
      put(pd.k - 0.5, pd.lane, 1, true);
      for (let j = 1; j <= 6; j++) put(pd.k - 0.5 - j, pd.lane, (7 - j) / 7 * 0.8, false);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.geometry.attributes.aAlpha.needsUpdate = true;
    this.mesh.geometry.attributes.aMain.needsUpdate = true;
  }
}
