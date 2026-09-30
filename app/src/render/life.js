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
  { tex: 'leaf', cols: [0xffb0c8, 0xffd6a0, 0xff9ab8], size: 0.45, glow: false },   // templo: pétalos
  { tex: 'dot', cols: [0xffa050, 0xff6a30], size: 0.18, glow: true },               // volcán: brasas
];

const Z_AXIS = new THREE.Vector3(0, 0, 1);

export class Life {
  constructor(scene) {
    this._qz = new THREE.Quaternion();
    this.tex = { leaf: leafTexture(), dot: dotTexture() };
    this.geo = new THREE.PlaneGeometry(1, 1);
    this.mat = new THREE.MeshBasicMaterial({ map: this.tex.leaf, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false, alphaTest: 0.05, forceSinglePass: true });
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
    const k = this.skin ? 99 : ((i % KIND.length) + KIND.length) % KIND.length;
    if (k === this.kind) return;
    this.kind = k; const K = this.K = this.skin || KIND[k];
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
    const r = outside ? 3.5 + Math.random() * 5 : 2.7 + Math.random() * 0.8;
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
    const K = this.K;
    const { m, q, sc, c } = this;
    const right = this._r.crossVectors(look, up).normalize();
    let n = 0;
    for (let i = 0; i < this.p.length; i++) {
      const p = this.p[i];
      // por fuera la mitad basta (sin paredes que las oculten, muchas llenarían un lado de la vista)
      if (outside && (i & 1)) { continue; }
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
      q.multiply(this._qz.setFromAxisAngle(Z_AXIS, p.rot));   // sin crear objetos por partícula
      const s = K.size * (outside ? 0.6 : 1) * (0.7 + 0.6 * ((p.col & 7) / 7)) * (K.glow ? 1 : 0.9 + 0.3 * Math.abs(Math.sin(p.flut)));
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

// ---- Mundo vivo lejos de la pista: bandadas que se espantan al pasar (islas y templo), lluvia en la
// selva y ceniza en el volcán. Solo POR FUERA del tubo y siempre en la periferia: cada partícula se
// encoge hasta desaparecer al acercarse al 30 % central de la vista (así no hay saltos ni nada
// que tape el centro, regla 6), nace pequeña y lejos, y las aves ni se acercan a la pista.
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// 0 dentro del 34 % central de la pantalla (el centro va a 30 %), 1 a partir del 52 %
const periphery = (n) => smooth(0.34, 0.52, Math.max(Math.abs(n.x), Math.abs(n.y)));

function birdTexture() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 32;
  const g = c.getContext('2d');
  g.strokeStyle = '#fff'; g.lineWidth = 5; g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath(); g.moveTo(4, 22); g.quadraticCurveTo(18, 2, 32, 20); g.quadraticCurveTo(46, 2, 60, 22); g.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function streakTexture() {
  const c = document.createElement('canvas'); c.width = 16; c.height = 64;
  const g = c.getContext('2d');
  const v = g.createLinearGradient(0, 0, 0, 64);
  v.addColorStop(0, 'rgba(255,255,255,0)'); v.addColorStop(0.55, 'rgba(255,255,255,0.95)'); v.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = v; g.fillRect(6, 0, 4, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

const FLOCKS = 3, PER = 14, NB = FLOCKS * PER, NP = 140;
// aves por mundo (índice de THEMES): solo donde hay cielo abierto de día o al atardecer
const BIRD_COL = { 0: 0x4a5f8a, 1: 0x4a5f8a, 3: 0x8a3a7a };

export class Wildlife {
  constructor(scene) {
    this.hidden = false;       // pruebas: oculta todo para comparar la misma escena con y sin partículas
    this.bg = 0; this.pg = 0;  // presencia suavizada de aves y de lluvia/ceniza (0..1)
    this.kind = null;
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.qz = new THREE.Quaternion();
    this.zAxis = new THREE.Vector3(0, 0, 1);
    this.sc = new THREE.Vector3(); this.c = new THREE.Color();
    this._r = new THREE.Vector3(); this._d = new THREE.Vector3(); this._n = new THREE.Vector3(); this._s = new THREE.Vector3(); this._w = new THREE.Vector3();
    const plane = new THREE.PlaneGeometry(1, 1);
    // aves
    this.birdMat = new THREE.MeshBasicMaterial({ map: birdTexture(), transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false, alphaTest: 0.05, forceSinglePass: true });
    this.birds = new THREE.InstancedMesh(plane, this.birdMat, NB);
    this.birds.frustumCulled = false; this.birds.count = 0; this.birds.renderOrder = 2;
    this.birds.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.birds);
    this.flocks = [];
    for (let i = 0; i < FLOCKS; i++) {
      const f = { c: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, -1), speed: 6, scared: -1, t: 0, live: false, b: [] };
      for (let j = 0; j < PER; j++) f.b.push({ o: new THREE.Vector3(), burst: new THREE.Vector3(), bv: new THREE.Vector3(), delay: 0, ph: 0, size: 3 });
      this.flocks.push(f);
    }
    // lluvia y ceniza (una sola malla; se cambia la textura según el mundo)
    this.tex = { streak: streakTexture(), dot: dotTexture() };
    this.precMat = new THREE.MeshBasicMaterial({ map: this.tex.streak, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false, alphaTest: 0.03, forceSinglePass: true });
    this.prec = new THREE.InstancedMesh(plane, this.precMat, NP);
    this.prec.frustumCulled = false; this.prec.count = 0; this.prec.renderOrder = 2;
    this.prec.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.prec);
    this.pp = [];
    for (let i = 0; i < NP; i++) this.pp.push({ pos: new THREE.Vector3(), ph: Math.random() * 6.28, rnd: Math.random(), col: 0, live: false });
  }

  // punto en NDC de p (solo válido si está delante de la cámara)
  ndc(p, cam) { return this._n.copy(p).applyMatrix4(cam.matrixWorldInverse).applyMatrix4(cam.projectionMatrix); }

  placeFlock(f, game, track, up, first) {
    const k = Math.floor(game.s) + (first ? 25 + Math.random() * 60 : 70 + Math.random() * 50);
    const r = track.rings.get(k) || track.last();
    const side3 = this._s.copy(r.F).cross(up); if (side3.lengthSq() < 1e-4) side3.copy(r.X); side3.normalize();
    const side = Math.random() < 0.5 ? -1 : 1;
    f.c.copy(r.P).addScaledVector(side3, side * (45 + Math.random() * 60)).addScaledVector(up, -15 + Math.random() * 45);
    f.dir.copy(r.F); f.speed = 5 + Math.random() * 4; f.scared = -1; f.t = 0; f.live = true;
    for (const b of f.b) {
      // nube alargada en el sentido del vuelo, con la cabeza de la bandada un poco delante
      b.o.set((Math.random() - 0.5) * 9, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 9).addScaledVector(f.dir, -Math.random() * 5);
      b.burst.set(0, 0, 0); b.delay = Math.random() * 0.35; b.ph = Math.random() * 6.28; b.size = 14 + Math.random() * 5;
    }
  }

  updateBirds(game, track, cam, look, up, show, dt, world) {
    this.bg += ((show ? 1 : 0) - this.bg) * Math.min(1, dt * (show ? 1.5 : 5));
    if (this.bg < 0.01 && !show) { this.birds.count = 0; for (const f of this.flocks) f.live = false; return; }
    const { m, q, qz, sc, c } = this;
    c.set(BIRD_COL[world] ?? 0x2c3e5c);
    let n = 0;
    for (const f of this.flocks) {
      if (!f.live) this.placeFlock(f, game, track, up, true);
      f.t += dt;
      f.c.addScaledVector(f.dir, f.speed * dt);
      const rel = this._d.copy(f.c).sub(cam.position);
      const dist = rel.length(), ahead = rel.dot(look);
      // se espantan cuando la pista pasa cerca: salen disparadas hacia fuera y hacia arriba
      if (f.scared < 0 && dist < 75 && ahead > -20) {
        f.scared = f.t;
        for (const b of f.b) {
          const w = this._w.copy(f.c).add(b.o).sub(cam.position);
          w.addScaledVector(look, -w.dot(look));
          if (w.lengthSq() < 1e-3) w.copy(up);
          w.normalize().multiplyScalar(0.8).addScaledVector(up, 0.4).addScaledVector(look, 0.3);
          b.bv.copy(w).multiplyScalar(18 + Math.random() * 16);
        }
      }
      // ya lejos por detrás, o desvanecida del susto: vuelve a nacer lejos y por delante
      if (ahead < -40 || (f.scared >= 0 && f.t - f.scared > 3.6)) { this.placeFlock(f, game, track, up, false); continue; }
      const since = f.scared < 0 ? 0 : f.t - f.scared;
      const fade = (1 - smooth(230, 330, dist)) * (1 - smooth(1.6, 3.6, since)) * smooth(0, 1.5, f.t);
      for (const b of f.b) {
        if (since > b.delay) b.burst.addScaledVector(b.bv, dt * Math.min(1, (since - b.delay) * 2));
        const p = this._w.copy(f.c).add(b.o).add(b.burst);
        p.y += 0.6 * Math.sin(f.t * 1.3 + b.ph);
        const rel2 = this._d.copy(p).sub(cam.position);
        if (rel2.dot(look) < 1) continue;
        const per = periphery(this.ndc(p, cam));
        const flap = 0.4 + 0.6 * Math.abs(Math.sin(f.t * (since > b.delay ? 14 : 5.5) + b.ph));
        const s = b.size * fade * per * this.bg;
        if (s < 0.02) continue;
        q.setFromRotationMatrix(m.lookAt(cam.position, p, up));
        sc.set(s, s * 0.5 * flap, 1);
        m.compose(p, q, sc);
        this.birds.setMatrixAt(n, m); this.birds.setColorAt(n, c);
        n++;
      }
    }
    this.birds.count = n;
    this.birds.instanceMatrix.needsUpdate = true;
    if (this.birds.instanceColor) this.birds.instanceColor.needsUpdate = true;
  }

  spawnP(p, cam, look, up, right, ahead) {
    // en el plano de la vista a esa distancia, lejos del eje: nunca por debajo de la pista
    const a = Math.random() * Math.PI * 2;
    const lat = ahead * (0.5 + Math.random() * 1.1);
    const ca = Math.cos(a), sa = Math.abs(Math.sin(a));
    p.pos.copy(cam.position).addScaledVector(look, ahead).addScaledVector(right, ca * lat).addScaledVector(up, sa * lat);
    p.live = true;
  }

  updatePrecip(cam, look, up, show, kind, dt) {
    this.pg += ((show ? 1 : 0) - this.pg) * Math.min(1, dt * (show ? 1.5 : 5));
    if (this.pg < 0.01 && !show) { this.prec.count = 0; for (const p of this.pp) p.live = false; return; }
    if (kind !== this.kind) {
      this.kind = kind; this.pg = 0;
      this.precMat.map = this.tex[kind === 'rain' ? 'streak' : 'dot'];
      this.precMat.needsUpdate = true;
      for (const p of this.pp) p.live = false;
    }
    const rain = kind === 'rain';
    const { m, q, qz, sc, c } = this;
    const right = this._r.crossVectors(look, up).normalize();
    let n = 0;
    for (const p of this.pp) {
      if (!p.live) this.spawnP(p, cam, look, up, right, 3 + Math.random() * 55);
      const rel = this._d.copy(p.pos).sub(cam.position);
      const ahead = rel.dot(look);
      if (ahead < 0.5 || ahead > 75) this.spawnP(p, cam, look, up, right, 52 + Math.random() * 8);
      p.ph += dt * (rain ? 0 : 1.6);
      if (rain) p.pos.addScaledVector(up, -13 * dt);
      else p.pos.addScaledVector(up, (-0.5 + 0.35 * Math.sin(p.ph)) * dt).addScaledVector(right, 0.7 * Math.sin(p.ph * 0.6) * dt);
      // no nacen ni mueren a la vista: se abren de lejos (40 → 55 m) y se cierran al pasar la cámara
      const rel2 = this._d.copy(p.pos).sub(cam.position), ah = rel2.dot(look);
      if (ah < 0.5) continue;
      const per = periphery(this.ndc(p.pos, cam));
      const near = smooth(1.5, 6, ah) * (1 - smooth(40, 55, ah));
      const k = per * near * this.pg;
      if (k < 0.02) continue;
      q.setFromRotationMatrix(m.lookAt(cam.position, p.pos, up));
      if (rain) { sc.set(0.5 * k, 7 * k, 1); c.set(0x2f7a5a); }
      else { const s = (0.5 + p.rnd * 0.45) * k; qz.setFromAxisAngle(this.zAxis, p.ph); q.multiply(qz); sc.set(s, s, 1); c.set(p.rnd < 0.4 ? 0xf0d8c8 : p.rnd < 0.75 ? 0xd8c0b0 : 0xffe8d8); }
      m.compose(p.pos, q, sc);
      this.prec.setMatrixAt(n, m); this.prec.setColorAt(n, c);
      n++;
    }
    this.prec.count = n;
    this.prec.instanceMatrix.needsUpdate = true;
    if (this.prec.instanceColor) this.prec.instanceColor.needsUpdate = true;
  }

  update(game, track, cam, look, up, outside, world, dt, on) {
    const w = ((world % 5) + 5) % 5;
    const vis = on && !this.hidden;
    this.birds.visible = this.prec.visible = vis;
    const kind = w === 1 ? 'rain' : w === 4 ? 'ash' : null;
    this.updateBirds(game, track, cam, look, up, vis && outside && (w === 0 || w === 3), dt, w);
    this.updatePrecip(cam, look, up, vis && outside && !!kind, kind || this.kind, dt);
    this.birds.visible = vis && this.birds.count > 0;
    this.prec.visible = vis && this.prec.count > 0;
  }
}
