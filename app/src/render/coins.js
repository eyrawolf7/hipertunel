// Monedas: doradas, girando sobre sí mismas a media altura sobre su carril. Al cogerlas saltan
// hacia arriba y se desvanecen en un destello pequeño (nunca tapan la vista).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { section, surf, makeFrame } from './track.js';
import { loadModel } from './assets.js';

const MAX = 120;
export class Coins {
  constructor(scene) {
    let geo = new THREE.CylinderGeometry(0.45, 0.45, 0.13, 32);
    geo.rotateX(Math.PI / 2);
    this.mat = new THREE.MeshStandardMaterial({ color: 0xffc21a, metalness: 0.85, roughness: 0.22, emissive: 0xff9a00, emissiveIntensity: 0.15 });
    this.mesh = new THREE.InstancedMesh(geo, this.mat, MAX);
    this.mesh.frustumCulled = false; this.mesh.count = 0;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.mesh);
    this.scene = scene;
    loadModel('coin').then((m) => {
      if (!m) return;
      const parts = [];
      m.updateMatrixWorld(true);
      m.traverse((o) => { if (o.isMesh) { const g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld); for (const k of Object.keys(g.attributes)) if (!['position', 'normal'].includes(k)) g.deleteAttribute(k); parts.push(g); } });
      if (!parts.length) return;
      const merged = mergeGeometries(parts.map((g) => g.index ? g.toNonIndexed() : g));
      if (!merged) return;
      merged.computeBoundingBox();
      const bb = merged.boundingBox, size = new THREE.Vector3(); bb.getSize(size);
      const c = new THREE.Vector3(); bb.getCenter(c); merged.translate(-c.x, -c.y, -c.z);
      merged.scale(0.9 / Math.max(size.x, size.y), 0.9 / Math.max(size.x, size.y), 0.9 / Math.max(size.x, size.y));
      this.mesh.geometry.dispose(); this.mesh.geometry = merged;
    });
    this.fr = makeFrame(); this.sp = {};
    this.m = new THREE.Matrix4(); this.T = new THREE.Vector3(); this.N = new THREE.Vector3(); this.B = new THREE.Vector3(); this.p = new THREE.Vector3();
    this.q = new THREE.Quaternion(); this.sc = new THREE.Vector3(); this.rot = new THREE.Matrix4();
    this.flying = [];
    this.time = 0;
  }

  collect(game, e, track) {
    // la moneda cogida sale disparada hacia arriba desde donde estaba
    const sec = section(game.fold), closed = game.fold === 30 || game.fold === -30;
    track.frameAt(e.k - 0.5, this.fr); surf(sec, e.lane, closed, this.sp);
    const N = new THREE.Vector3().copy(this.fr.X).multiplyScalar(this.sp.nx).addScaledVector(this.fr.U, this.sp.ny);
    const p = new THREE.Vector3().copy(this.fr.P).addScaledVector(this.fr.X, this.sp.x).addScaledVector(this.fr.U, this.sp.y).addScaledVector(N, 0.85);
    this.flying.push({ p, v: N.multiplyScalar(9).addScaledVector(this.fr.F, game.speedMS * 1.05), t: 0 });
  }

  update(game, track, dt, camPos) {
    this.time += dt;
    const sec = section(game.fold), closed = game.fold === 30 || game.fold === -30;
    const { fr, sp, m, T, N, B, p } = this;
    let n = 0;
    for (const c of game.coins) {
      if (c.got || n >= MAX) continue;
      const sMid = c.k - 0.5;
      if (!track.rings.has(Math.floor(sMid)) || !track.rings.has(Math.floor(sMid) + 1)) continue;
      track.frameAt(sMid, fr); surf(sec, c.lane, closed, sp);
      T.copy(fr.X).multiplyScalar(sp.tx).addScaledVector(fr.U, sp.ty);
      N.copy(fr.X).multiplyScalar(sp.nx).addScaledVector(fr.U, sp.ny);
      B.copy(fr.F).negate();
      const bob = Math.sin(this.time * 4 + c.k * 0.7) * 0.06;
      p.copy(fr.P).addScaledVector(fr.X, sp.x).addScaledVector(fr.U, sp.y).addScaledVector(N, 0.85 + bob + game.jumpAt(sMid));
      m.makeBasis(T, N, B);
      m.multiply(this.rot.makeRotationY(this.time * 3 + c.k * 0.5));
      const dc = camPos ? p.distanceTo(camPos) : 99;
      if (dc < 4) m.scale(this.sc.setScalar(Math.max(0, (dc - 1.2) / 2.8)));
      m.setPosition(p);
      this.mesh.setMatrixAt(n++, m);
    }
    for (let i = this.flying.length - 1; i >= 0; i--) {
      const f = this.flying[i];
      f.t += dt; if (f.t > 0.25 || n >= MAX) { this.flying.splice(i, 1); continue; }
      f.p.addScaledVector(f.v, dt);
      const k = 1 - f.t / 0.25;
      m.makeRotationY(this.time * 20).scale(this.sc.setScalar(0.8 * k)).setPosition(f.p);
      this.mesh.setMatrixAt(n++, m);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
