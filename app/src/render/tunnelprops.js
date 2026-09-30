// Adornos del túnel de piedra: anillos de costillas talladas cada 8 filas con cristales turquesa
// en las uniones, y enredaderas que trepan por las juntas. Todo va por FUERA del tubo (normal hacia
// fuera), así nunca invade el espacio por el que se conduce; se ve por los arcos y en las fases
// por fuera.
import * as THREE from 'three';
import { LANES } from '../sim/game.js';
import { section, toWorld } from './track.js';
import { loadModel } from './assets.js';

// Un modelo GLB con varias mallas o materiales pasa a un grupo de InstancedMesh que se mueven juntas.
function instanced(model, max, scene) {
  const parts = [];
  model.updateMatrixWorld(true);
  model.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld);
    const im = new THREE.InstancedMesh(g, o.material, max);
    im.frustumCulled = false; im.count = 0;
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(im); parts.push(im);
  });
  return {
    parts, n: 0,
    begin() { this.n = 0; },
    add(m) { if (this.n >= max) return; for (const p of parts) p.setMatrixAt(this.n, m); this.n++; },
    end() { for (const p of parts) { p.count = this.n; p.instanceMatrix.needsUpdate = true; } },
    setVisible(v) { for (const p of parts) p.visible = v; },
  };
}

const h = (a, b) => { const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return x - Math.floor(x); };

export class TunnelProps {
  constructor(scene) {
    this.scene = scene; this.ready = false;
    this.m = new THREE.Matrix4(); this.T = new THREE.Vector3(); this.N = new THREE.Vector3(); this.O = new THREE.Vector3(); this.p = new THREE.Vector3(); this.q = new THREE.Vector3();
    Promise.all(['rib_stone', 'crystal_cluster', 'vine_edge', 'vine_hang'].map((n) => loadModel(n))).then(([rib, cry, vine, hang]) => {
      if (rib) this.rib = instanced(rib, 12 * 6, scene);
      if (cry) this.cry = instanced(cry, 12 * 6 + 40, scene);
      // el verde de las enredaderas era primo del carril encendido (regla 3): oliva apagado
      const olive = (model) => model.traverse((o) => {
        if (!o.isMesh || o.userData.olive || Array.isArray(o.material)) return;   // el modelo viene de la caché: una sola vez
        o.userData.olive = true;
        o.material = o.material.clone();
        const hsl = {}; o.material.color.getHSL(hsl);
        o.material.color.setHSL(0.2, hsl.s * 0.4, hsl.l * 0.85);
        const col = o.geometry.attributes.color;   // las hojas llevan el verde en los vértices
        if (!col) return;
        o.geometry = o.geometry.clone();
        const a = o.geometry.attributes.color, c = new THREE.Color();
        for (let i = 0; i < a.count; i++) {
          c.fromBufferAttribute(a, i).getHSL(hsl);
          c.setHSL(0.2, hsl.s * 0.4, hsl.l * 0.85);
          a.setXYZ(i, c.r, c.g, c.b);
        }
        a.needsUpdate = true;
      });
      if (vine) { olive(vine); this.vine = instanced(vine, 160, scene); }
      if (hang) { olive(hang); hang.traverse((o) => { if (o.isMesh) o.material.side = THREE.DoubleSide; }); this.hang = instanced(hang, 80, scene); }
      this.ready = !!(rib || cry || vine);
    });
  }

  setVisible(v) { for (const k of ['rib', 'cry', 'vine', 'hang']) this[k] && this[k].setVisible(v); }

  update(game, track) {
    if (!this.ready) return;
    const sec = section(game.fold);
    const { m, T, N, O, p, q } = this;
    const kNear = Math.floor(game.s) - 2;
    this.rib && this.rib.begin(); this.cry && this.cry.begin(); this.vine && this.vine.begin(); this.hang && this.hang.begin();
    const closed = game.fold === 30 || game.fold === -30;
    for (let k = kNear; k <= game.kLast; k++) {
      const r = track.rings.get(k); if (!r || game.inGap(k)) continue;
      const rib = k % 8 === 0;
      for (let c = 0; c < LANES; c++) {
        const b = sec.b, d = sec.d;
        const tx = d[c * 2], ty = d[c * 2 + 1];
        T.copy(r.X).multiplyScalar(tx).addScaledVector(r.U, ty);
        N.copy(r.X).multiplyScalar(-ty).addScaledVector(r.U, tx);   // hacia dentro
        O.copy(N).negate();                                          // hacia fuera
        // centro de la cara en este anillo
        toWorld(r, (b[c * 2] + b[c * 2 + 2]) / 2, (b[c * 2 + 1] + b[c * 2 + 3]) / 2, p);
        if (rib && this.rib) {
          m.makeBasis(T, O, r.F); m.setPosition(q.copy(p).addScaledVector(O, 0.3));
          this.rib.add(m);
        }
        if (rib && this.cry && (c & 1) === 0) {
          toWorld(r, b[c * 2], b[c * 2 + 1], q); q.addScaledVector(O, 0.6);
          m.makeBasis(T, O, r.F); m.scale(p.set(1.6, 1.6, 1.6)); m.setPosition(q);
          this.cry.add(m);
        }
        // enredadera trepando por la junta, en unas pocas al azar (siempre las mismas)
        if (this.vine && h(k, c) < 0.22) {
          const r2 = track.rings.get(k + 1); if (!r2) continue;
          toWorld(r, b[c * 2], b[c * 2 + 1], q);
          const q2 = new THREE.Vector3(); toWorld(r2, b[c * 2], b[c * 2 + 1], q2);
          q.lerp(q2, 0.5).addScaledVector(O, 0.36);
          m.makeBasis(T, O, r.F); m.setPosition(q);
          this.vine.add(m);
        }
      }
      // lámina abierta: enredaderas que cuelgan por el faldón de cada borde y algún cristal en el
      // canto, siempre por fuera de la calzada (nada que invada un carril)
      if (!closed) {
        const b = sec.b, d = sec.d;
        for (const side of [0, 1]) {
          const c = side ? LANES - 1 : 0;
          const tx = d[c * 2], ty = d[c * 2 + 1], sg = side ? 1 : -1;
          N.copy(r.X).multiplyScalar(-ty).addScaledVector(r.U, tx);                 // normal de la calzada
          T.copy(r.X).multiplyScalar(tx * sg).addScaledVector(r.U, ty * sg);         // hacia fuera
          toWorld(r, b[side ? LANES * 2 : 0], b[side ? LANES * 2 + 1 : 1], p);
          if (this.hang && h(k, 20 + side) < 0.6) {
            O.crossVectors(r.F, N).normalize();
            m.makeBasis(r.F, N, O); m.scale(q.set(2.2, 1.0 + 0.9 * h(k, 30 + side), 2.2));
            m.setPosition(q.copy(p).addScaledVector(T, 0.06).addScaledVector(N, 0.02));
            this.hang.add(m);
          }
          if (this.cry && k % 6 === side * 3) {
            O.crossVectors(T, r.F).normalize();
            m.makeBasis(O, T, r.F); m.scale(q.set(1.8, 1.8, 1.8));
            m.setPosition(q.copy(p).addScaledVector(N, -0.5).addScaledVector(T, 0.1));
            this.cry.add(m);
          }
        }
      }
    }
    this.rib && this.rib.end(); this.cry && this.cry.end(); this.vine && this.vine.end(); this.hang && this.hang.end();
  }
}
