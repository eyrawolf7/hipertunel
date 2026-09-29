// Cartón del Arcade: el bloque rompible del muro (kit/carton.glb, textura kraft con el puño) y su
// rotura en primera persona. Los 13 trozos salen con el jugador y se abren hacia los bordes de la
// vista (ninguno se queda delante del centro), giran y se encogen en 0,45 s.
import * as THREE from 'three';
import { loadModel } from './assets.js';
import { stylize } from './stylize.js';

const LIFE = 0.35;
const POOL = 3;                 // roturas a la vez

export class Carton {
  constructor(scene) {
    this.scene = scene;
    this.ready = false;
    this.inst = null;           // InstancedMesh del bloque (lo rellena boxes.js)
    this.shards = [];           // [{ geo, off }] en el cubo unidad
    this.sets = [];             // juegos de mallas para las roturas
    this.live = [];
    this._v = new THREE.Vector3(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(); this._s = new THREE.Vector3();
    this.load();
  }

  async load() {
    const m = await loadModel('kit/carton');
    if (!m) return;
    m.updateMatrixWorld(true);
    let boxMesh = null;
    const root = m.getObjectByName('box_carton');
    (root || m).traverse((o) => { if (o.isMesh && !boxMesh) boxMesh = o; });
    if (!boxMesh) return;
    const mat = stylize(boxMesh.material.clone(), { rim: 0.3, key: 'carton' });
    mat.color?.setRGB(1, 1, 1);
    this.mat = mat;
    const g = boxMesh.geometry.clone();
    if (g.attributes.color) g.deleteAttribute('color');
    this.inst = new THREE.InstancedMesh(g, mat, 16);
    this.inst.frustumCulled = false; this.inst.count = 0;
    this.inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.inst);
    const sh = m.getObjectByName('carton_shards');
    if (sh) sh.traverse((o) => {
      if (!o.isMesh) return;
      const geo = o.geometry.clone();
      if (geo.attributes.color) geo.deleteAttribute('color');
      const off = new THREE.Vector3(); o.getWorldPosition(off);
      // la geometría del trozo va centrada en su origen; se guarda su giro en el cubo
      const q = new THREE.Quaternion(); o.getWorldQuaternion(q);
      this.shards.push({ geo, off, q });
    });
    for (let i = 0; i < POOL; i++) {
      const set = this.shards.map((s) => { const me = new THREE.Mesh(s.geo, mat); me.visible = false; me.frustumCulled = false; this.scene.add(me); return me; });
      this.sets.push(set);
    }
    this.ready = true;
  }

  // box: matriz del bloque (base T, N, B escalada a w, h, len); fwd: avance del jugador (unitario);
  // speed: m/s; cam: posición y dirección de la cámara
  smash(box, fwd, speed, camPos, camDir) {
    if (!this.ready || !this.shards.length) return;
    const set = this.sets.shift(); this.sets.push(set);
    this.live = this.live.filter((l) => l.set !== set);
    const pos = new THREE.Vector3(), rot = new THREE.Quaternion(), scl = new THREE.Vector3();
    box.decompose(pos, rot, scl);
    const parts = [];
    this.shards.forEach((s, i) => {
      const me = set[i];
      const p = s.off.clone().multiply(scl).applyQuaternion(rot).add(pos);
      // hacia fuera del bloque, y lejos del eje de la vista (al menos ~25° del centro)
      const out = p.clone().sub(pos).normalize().multiplyScalar(5 + Math.random() * 4);
      const rad = p.clone().sub(camPos); rad.addScaledVector(camDir, -rad.dot(camDir));
      if (rad.lengthSq() < 1e-4) rad.set(Math.random() - 0.5, 1, Math.random() - 0.5);
      rad.normalize().multiplyScalar(9 + Math.random() * 5);
      // más lentos que tú hacia delante: la cámara los adelanta y se abren hacia los bordes
      const v = out.add(rad).addScaledVector(fwd, speed * (0.55 + Math.random() * 0.1));
      const spin = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).multiplyScalar(14);
      me.visible = true;
      parts.push({ me, p, v, spin, q0: rot.clone().multiply(s.q), scl: scl.clone() });
    });
    this.live.push({ set, parts, age: 0 });
  }

  update(dt) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const l = this.live[i];
      l.age += dt;
      const t = l.age / LIFE;
      if (t >= 1) { for (const pt of l.parts) pt.me.visible = false; this.live.splice(i, 1); continue; }
      const k = 1 - t * t;                    // se encogen (easeInQuad)
      for (const pt of l.parts) {
        pt.p.addScaledVector(pt.v, dt);
        pt.me.position.copy(pt.p);
        this._q.setFromEuler(this._e.set(pt.spin.x * l.age, pt.spin.y * l.age, pt.spin.z * l.age));
        pt.me.quaternion.copy(pt.q0).multiply(this._q);
        pt.me.scale.copy(pt.scl).multiplyScalar(k);
      }
    }
  }

  reset() { for (const l of this.live) for (const pt of l.parts) pt.me.visible = false; this.live.length = 0; }
}
