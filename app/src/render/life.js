// Vida del escenario: hojas, pétalos, luciérnagas o brasas que pasan junto a las paredes del
// túnel (o a los lados de la pista por fuera). Son pequeñas, van siempre por la periferia de la
// vista (nunca por el centro, regla 6) y quietas en el mundo, así que al correr pasan a toda
// velocidad y suman sensación de velocidad. Solo en calidad alta/media.
import * as THREE from 'three';

const N = 70;

// forma de hoja/pétalo en un lienzo pequeño (alfa), para no cargar texturas
function leafTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.beginPath(); g.moveTo(32, 4); g.quadraticCurveTo(62, 30, 32, 60); g.quadraticCurveTo(2, 30, 32, 4); g.fill();
  g.globalCompositeOperation = 'destination-out'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(32, 10); g.lineTo(32, 56); g.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function dotTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.35, 'rgba(255,255,255,0.6)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// qué pasa volando en cada mundo (por índice de THEMES)
const KIND = [
  { tex: 'leaf', cols: [0x7fc24a, 0xa8d45a, 0xe6c35a], size: 0.32, glow: false },   // islas: hojas
  { tex: 'leaf', cols: [0x4fae4a, 0x8fd060, 0x3f8f3a], size: 0.36, glow: false },   // selva: hojas
  { tex: 'dot', cols: [0x9dfff0, 0xd8ff8a], size: 0.22, glow: true },               // noche: luciérnagas
  { tex: 'leaf', cols: [0xffb0c8, 0xffd6a0, 0xff9ab8], size: 0.3, glow: false },   // templo: pétalos
  { tex: 'dot', cols: [0xffa050, 0xff6a30], size: 0.18, glow: true },               // volcán: brasas
];

export class Life {
  constructor(scene) {
    this.tex = { leaf: leafTexture(), dot: dotTexture() };
    this.geo = new THREE.PlaneGeometry(1, 1);
    this.mat = new THREE.MeshBasicMaterial({ map: this.tex.leaf, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false, alphaTest: 0.05 });
    this.mesh = new THREE.InstancedMesh(this.geo, this.mat, N);
    this.mesh.frustumCulled = false; this.mesh.count = 0; this.mesh.renderOrder = 2;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.mesh);
    this.p = [];
    for (let i = 0; i < N; i++) this.p.push({ pos: new THREE.Vector3(), rot: Math.random() * 6.28, spin: (Math.random() - 0.5) * 6, flut: Math.random() * 6.28, col: 0, live: false });
    this.kind = -1;
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.sc = new THREE.Vector3(); this.c = new THREE.Color();
    this._r = new THREE.Vector3(); this._u = new THREE.Vector3(); this._d = new THREE.Vector3();
  }

  setWorld(i) {
    const k = ((i % KIND.length) + KIND.length) % KIND.length;
    if (k === this.kind) return;
    this.kind = k; const K = KIND[k];
    this.mat.map = this.tex[K.tex];
    this.mat.blending = K.glow ? THREE.AdditiveBlending : THREE.NormalBlending;
    this.mat.needsUpdate = true;
    for (const p of this.p) p.col = K.cols[(Math.random() * K.cols.length) | 0];
  }

  spawn(p, cam, look, up, outside, near) {
    const right = this._r.crossVectors(look, up).normalize();
    const a = Math.random() * Math.PI * 2;
    // dentro: en un anillo pegado a la pared, alrededor del eje del tubo (unos 3,2 m por encima de
    // la cámara, que va a ras de suelo); fuera: a los lados y por encima de la pista
    const r = outside ? 4 + Math.random() * 7 : 2.7 + Math.random() * 0.8;
    let ca = Math.cos(a), sa = Math.sin(a);
    if (outside && sa < -0.2) sa = -sa;                 // por fuera, nada por debajo de la pista
    const d = near ? 4 + Math.random() * 20 : 18 + Math.random() * 8;
    p.pos.copy(cam.position).addScaledVector(look, d).addScaledVector(right, ca * r).addScaledVector(up, sa * r + (outside ? 0.5 : 3.2));
    p.live = true;
  }

  update(cam, look, up, outside, world, dt, on, invert) {
    this.mesh.visible = on && invert < 0.5;
    if (!this.mesh.visible) { for (const p of this.p) p.live = false; return; }
    this.setWorld(world);
    const K = KIND[this.kind];
    const { m, q, sc, c } = this;
    const right = this._r.crossVectors(look, up).normalize();
    let n = 0;
    for (const p of this.p) {
      if (!p.live) this.spawn(p, cam, look, up, outside, true);
      const rel = this._d.copy(p.pos).sub(cam.position);
      const ahead = rel.dot(look);
      // detrás de la cámara o demasiado lejos (la pista ha girado): vuelve a nacer delante
      if (ahead < -1 || rel.lengthSq() > 90 * 90) { this.spawn(p, cam, look, up, outside, false); }
      // nunca en el centro de la vista: si se ha colado en el cono central, fuera
      const lat = Math.hypot(rel.dot(right), rel.dot(up));
      if (ahead > 0 && lat < ahead * 0.12 + 0.7) { this.spawn(p, cam, look, up, outside, false); }
      // caída suave y aleteo
      p.flut += dt * 3; p.rot += p.spin * dt;
      p.pos.addScaledVector(up, (K.glow ? 0.15 * Math.sin(p.flut) : -0.35) * dt).addScaledVector(right, 0.3 * Math.sin(p.flut * 0.7) * dt);
      q.setFromRotationMatrix(m.lookAt(cam.position, p.pos, up));
      q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), p.rot));
      const s = K.size * (0.7 + 0.6 * ((p.col & 7) / 7)) * (K.glow ? 1 : 0.9 + 0.3 * Math.abs(Math.sin(p.flut)));
      sc.set(s, s * (K.tex === 'leaf' ? 1.4 : 1), s);
      m.compose(p.pos, q, sc);
      this.mesh.setMatrixAt(n, m);
      this.mesh.setColorAt(n, c.set(p.col).multiplyScalar(K.glow ? 1.8 : 1));
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
