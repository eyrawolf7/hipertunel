// Decorado de las fases por fuera: islas flotantes, nubes, cristales, planetas. Siempre lejos de
// la pista y más allá de la niebla cercana (regla 5): nada aparece de golpe ni en el camino.
// Si están los modelos GLB del modelador se usan; si no, formas procedurales de respaldo.
import * as THREE from 'three';
import { loadModel } from './assets.js';
import { makeFrame } from './track.js';

const KINDS = {
  sky: ['island_a', 'island_b', 'island_c', 'cloud', 'cloud', 'arch'],
  neon: ['crystal', 'crystal', 'arch', 'planet', 'cloud'],
  space: ['planet', 'crystal', 'island_b', 'crystal', 'cloud'],
};

export class Decor {
  constructor(scene) {
    this.group = new THREE.Group(); scene.add(this.group);
    this.models = {};
    this.items = [];
    this.theme = null;
    this.fr = makeFrame();
    this.fallback();
    this.load();
  }

  fallback() {
    const white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, emissive: 0xdfe8ff, emissiveIntensity: 0.25 });
    const grass = new THREE.MeshStandardMaterial({ color: 0x7ed957, roughness: 0.8, flatShading: true });
    const rock = new THREE.MeshStandardMaterial({ color: 0xd9a37a, roughness: 0.9, flatShading: true });
    const cloud = () => { const g = new THREE.Group(); for (let i = 0; i < 6; i++) { const m = new THREE.Mesh(new THREE.IcosahedronGeometry(3 + Math.random() * 3, 2), white); m.position.set((Math.random() - 0.5) * 12, Math.random() * 2, (Math.random() - 0.5) * 6); m.scale.y = 0.75; g.add(m); } return g; };
    const island = () => { const g = new THREE.Group(); const t = new THREE.Mesh(new THREE.CylinderGeometry(10, 9, 2.5, 12), grass); g.add(t); const b = new THREE.Mesh(new THREE.ConeGeometry(9, 16, 10), rock); b.rotation.x = Math.PI; b.position.y = -9; g.add(b); return g; };
    const crystal = () => { const g = new THREE.Group(); const m = new THREE.MeshStandardMaterial({ color: 0xff7ae0, emissive: 0xff3fd0, emissiveIntensity: 1.2, roughness: 0.2 }); for (let i = 0; i < 4; i++) { const c = new THREE.Mesh(new THREE.OctahedronGeometry(1.5 + Math.random() * 2), m); c.scale.y = 2.2; c.position.set((Math.random() - 0.5) * 4, 0, (Math.random() - 0.5) * 4); c.rotation.z = (Math.random() - 0.5) * 0.6; g.add(c); } return g; };
    const planet = () => { const g = new THREE.Group(); g.add(new THREE.Mesh(new THREE.SphereGeometry(22, 32, 16), new THREE.MeshStandardMaterial({ color: 0xffb3d9, roughness: 0.7 }))); const r = new THREE.Mesh(new THREE.TorusGeometry(34, 2, 8, 64), new THREE.MeshStandardMaterial({ color: 0xfff0b3, roughness: 0.5 })); r.rotation.x = 1.2; g.add(r); return g; };
    const arch = () => { const g = new THREE.Group(); g.add(new THREE.Mesh(new THREE.TorusGeometry(12, 1.3, 12, 48), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 }))); return g; };
    this.make = { island_a: island, island_b: island, island_c: island, cloud, crystal, planet, arch };
  }

  load() {
    for (const name of ['island_a', 'island_b', 'island_c', 'cloud', 'crystal', 'planet', 'arch']) {
      loadModel(name).then((m) => { if (m) { this.models[name] = m; this.rebuild = true; this.onLoad && this.onLoad(); } });
    }
  }

  build(name) {
    const m = this.models[name];
    if (m) {
      const o = m.clone(true);
      // el decorado queda por debajo del umbral del bloom: solo brillan bombillas y cristales
      o.traverse((c) => { if (c.isMesh && c.material) { c.material = c.material.clone(); c.material.envMapIntensity = 0.45; if (c.material.color) c.material.color.multiplyScalar(0.82); } });
      return o;
    }
    return this.make[name]();
  }

  setTheme(theme) {
    if (this.theme === theme.decor && !this.rebuild) return;
    this.theme = theme.decor; this.rebuild = false;
    for (const it of this.items) this.group.remove(it.obj);
    this.items = [];
    const kinds = KINDS[this.theme] || KINDS.sky;
    for (let i = 0; i < 16; i++) {
      const name = kinds[i % kinds.length];
      const obj = this.build(name);
      const big = name === 'planet' ? 2.4 : name.startsWith('island') ? 1.6 : name === 'arch' ? 1.4 : 1;
      obj.scale.multiplyScalar(big * (0.75 + Math.random() * 0.5));
      this.group.add(obj);
      this.items.push({ obj, name, placed: false, spin: (Math.random() - 0.5) * 0.2 });
    }
  }

  place(it, game, track, far) {
    const k = game.kLast - (far ? 0 : Math.floor(Math.random() * 20));
    const r = track.rings.get(k) || track.last();
    const side = Math.random() < 0.5 ? -1 : 1;
    // lejos de la pista y nunca a su altura cerca de ella: o por debajo de la carretera o muy arriba
    const lateral = side * (75 + Math.random() * 130);
    const low = Math.random() < 0.7;
    const vertical = it.name === 'planet' ? 90 + Math.random() * 80
      : it.name === 'cloud' ? (low ? -55 + Math.random() * 30 : 45 + Math.random() * 40)
      : (low ? -70 + Math.random() * 45 : 40 + Math.random() * 35);
    const ahead = 120 + Math.random() * 280;
    it.obj.position.copy(r.P).addScaledVector(r.F, ahead).addScaledVector(r.X, lateral).addScaledVector(r.U, vertical);
    it.obj.rotation.y = Math.random() * Math.PI * 2;
    it.k = k + ahead / 4;
    it.placed = true;
  }

  update(game, track, camera, outside, dt) {
    this.group.visible = outside;
    if (!outside) { for (const it of this.items) it.placed = false; return; }
    for (const it of this.items) {
      if (!it.placed) this.place(it, game, track, false);
      else if (it.k < game.s - 30) this.place(it, game, track, true);
      it.obj.rotation.y += it.spin * dt;
      // la pista curva: si algo se ha quedado cerca de ella, se lleva a otro sitio
      if (!it.checkT || (it.checkT -= dt) <= 0) {
        it.checkT = 0.25;
        for (let k = Math.floor(game.s); k <= game.kLast; k += 3) { const r = track.rings.get(k); if (r && r.P.distanceTo(it.obj.position) < 65) { this.place(it, game, track, true); break; } }
      }
    }
  }
}
