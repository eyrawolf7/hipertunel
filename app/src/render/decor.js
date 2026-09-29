// Decorado de las fases por fuera: islas flotantes, nubes, cristales, planetas. Siempre lejos de
// la pista y más allá de la niebla cercana (regla 5): nada aparece de golpe ni en el camino.
// Si están los modelos GLB del modelador se usan; si no, formas procedurales de respaldo.
import * as THREE from 'three';
import { loadModel } from './assets.js';
import { makeFrame } from './track.js';

const KINDS = {
  sky: ['island_castle', 'island_a', 'island_b', 'cloud', 'island_c', 'ruin_arch', 'cloud'],
  neon: ['island_b', 'crystal', 'island_castle', 'cloud', 'crystal', 'ruin_arch'],
  space: ['volcano', 'island_c', 'crystal', 'ruin_arch', 'island_a'],
};

// perspectiva aérea: el decorado se mezcla con el color del horizonte según la distancia a la
// cámara (12 % a 150 m, 35 % a 600 m), así se funde con el panorama en vez de parecer una pegatina
export const aerialU = { uAirCol: { value: new THREE.Color(0xcfe6ff) } };
function aerial(mat) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uAirCol = aerialU.uAirCol;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uAirCol;')
      .replace('#include <opaque_fragment>', `float airD = length(vViewPosition);
outgoingLight = mix(outgoingLight, uAirCol, mix(0.12, 0.35, smoothstep(150.0, 600.0, airD)) * smoothstep(60.0, 150.0, airD));
#include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => 'decor-air';
}

export class Decor {
  constructor(scene) {
    this.group = new THREE.Group(); scene.add(this.group);
    this.models = {};
    this.items = [];
    this.theme = null;
    this.fr = makeFrame();
    this.camUp = new THREE.Vector3(0, 1, 0);
    this.fallback();
    this.load();
  }

  fallback() {
    // (el decorado va lejos, más allá de la niebla del túnel: no la recibe)
    const white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, emissive: 0xdfe8ff, emissiveIntensity: 0.25 });
    const grass = new THREE.MeshStandardMaterial({ color: 0x7ed957, roughness: 0.8, flatShading: true });
    const rock = new THREE.MeshStandardMaterial({ color: 0xd9a37a, roughness: 0.9, flatShading: true });
    const cloud = () => { const g = new THREE.Group(); for (let i = 0; i < 6; i++) { const m = new THREE.Mesh(new THREE.IcosahedronGeometry(3 + Math.random() * 3, 2), white); m.position.set((Math.random() - 0.5) * 12, Math.random() * 2, (Math.random() - 0.5) * 6); m.scale.y = 0.75; g.add(m); } return g; };
    const island = () => { const g = new THREE.Group(); const t = new THREE.Mesh(new THREE.CylinderGeometry(10, 9, 2.5, 12), grass); g.add(t); const b = new THREE.Mesh(new THREE.ConeGeometry(9, 16, 10), rock); b.rotation.x = Math.PI; b.position.y = -9; g.add(b); return g; };
    const crystal = () => { const g = new THREE.Group(); const m = new THREE.MeshStandardMaterial({ color: 0xff7ae0, emissive: 0xff3fd0, emissiveIntensity: 1.2, roughness: 0.2 }); for (let i = 0; i < 4; i++) { const c = new THREE.Mesh(new THREE.OctahedronGeometry(1.5 + Math.random() * 2), m); c.scale.y = 2.2; c.position.set((Math.random() - 0.5) * 4, 0, (Math.random() - 0.5) * 4); c.rotation.z = (Math.random() - 0.5) * 0.6; g.add(c); } return g; };
    const planet = () => { const g = new THREE.Group(); g.add(new THREE.Mesh(new THREE.SphereGeometry(22, 32, 16), new THREE.MeshStandardMaterial({ color: 0xffb3d9, roughness: 0.7 }))); const r = new THREE.Mesh(new THREE.TorusGeometry(34, 2, 8, 64), new THREE.MeshStandardMaterial({ color: 0xfff0b3, roughness: 0.5 })); r.rotation.x = 1.2; g.add(r); return g; };
    const arch = () => { const g = new THREE.Group(); g.add(new THREE.Mesh(new THREE.TorusGeometry(12, 1.3, 12, 48), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 }))); return g; };
    this.make = { island_a: island, island_b: island, island_c: island, cloud, crystal, planet, arch, island_castle: island, ruin_arch: arch, volcano: planet };
  }

  load() {
    for (const name of ['island_a', 'island_b', 'island_c', 'cloud', 'crystal', 'planet', 'arch', 'island_castle', 'ruin_arch', 'volcano']) {
      loadModel(name).then((m) => { if (m) { this.models[name] = m; this.rebuild = true; this.onLoad && this.onLoad(); } });
    }
  }

  build(name) {
    const m = this.models[name];
    if (m) {
      const o = m.clone(true);
      // el decorado queda por debajo del umbral del bloom: solo brillan bombillas y cristales
      o.traverse((c) => { if (c.isMesh && c.material) { c.material = c.material.clone(); c.material.envMapIntensity = 0.3; c.material.fog = false; if (c.material.color) c.material.color.multiplyScalar(0.9); if (c.material.color) aerial(c.material); } });
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
    for (let i = 0; i < 24; i++) {
      const name = kinds[i % kinds.length];
      const obj = this.build(name);
      const big = name === 'planet' ? 2.4 : name === 'volcano' ? 2.2 : name.startsWith('island') ? 1.6 : name === 'arch' || name === 'ruin_arch' ? 1.6 : 1;
      obj.scale.multiplyScalar(big * (0.75 + Math.random() * 0.5));
      this.group.add(obj);
      this.items.push({ obj, name, placed: false, spin: (Math.random() - 0.5) * 0.2 });
    }
  }

  place(it, game, track, far) {
    const k = game.kLast - (far ? 0 : Math.floor(Math.random() * 20));
    const r = track.rings.get(k) || track.last();
    const side = Math.random() < 0.5 ? -1 : 1;
    // lejos de la pista y nunca a su altura cerca de ella. La altura va con la vertical de la
    // cámara (que gira con el carril en el que vas): las islas quedan casi siempre por debajo de
    // lo que ves y se ve su césped, como en el concepto; vistas desde abajo parecen conchas.
    const lateral = side * (120 + Math.random() * 110);
    const low = Math.random() < (it.name.startsWith('island') || it.name === 'volcano' ? 0.92 : 0.7);
    const vertical = it.name === 'planet' ? 90 + Math.random() * 80
      : it.name === 'cloud' ? (low ? -55 + Math.random() * 30 : 45 + Math.random() * 40)
      : (low ? -75 + Math.random() * 45 : 45 + Math.random() * 30);
    const ahead = 120 + Math.random() * 520;
    const up = this.camUp;
    const side3 = this._side || (this._side = new THREE.Vector3());
    side3.copy(r.F).cross(up); if (side3.lengthSq() < 1e-4) side3.copy(r.X); side3.normalize();
    it.obj.position.copy(r.P).addScaledVector(r.F, ahead).addScaledVector(side3, lateral).addScaledVector(up, vertical);
    it.obj.quaternion.setFromUnitVectors(this._y || (this._y = new THREE.Vector3(0, 1, 0)), up);
    it.obj.rotateY(Math.random() * Math.PI * 2);
    it.k = k + ahead / 4;
    it.placed = true;
  }

  update(game, track, camera, outside, dt) {
    this.group.visible = outside;
    if (!outside) { for (const it of this.items) it.placed = false; return; }
    if (camera) this.camUp.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
    for (const it of this.items) {
      if (!it.placed) this.place(it, game, track, false);
      else if (it.k < game.s - 30) this.place(it, game, track, true);
      it.obj.rotateY(it.spin * dt);
      // la pista curva: si algo se ha quedado cerca de ella, se lleva a otro sitio
      if (!it.checkT || (it.checkT -= dt) <= 0) {
        it.checkT = 0.25;
        for (let k = Math.floor(game.s); k <= game.kLast; k += 3) { const r = track.rings.get(k); if (r && r.P.distanceTo(it.obj.position) < 90) { this.place(it, game, track, true); break; } }
      }
    }
  }
}
