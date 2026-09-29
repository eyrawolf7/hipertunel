// Protagonista del modo en tercera persona: el zorro en su tabla de hoja. Carga fox.glb (esqueleto
// y animaciones de Blender) si está; si no, un muñeco provisional con la misma silueta (orejas,
// cola y tabla). Se coloca sobre la superficie del túnel con su "arriba" = la normal del carril y
// se inclina con el giro. Solo es dibujo: la simulación no cambia.
import * as THREE from 'three';
import { loadModel, hasAsset } from './assets.js';
import { stylize } from './stylize.js';

const ANIMS = ['ride', 'leanL', 'leanR', 'jump', 'land', 'boost', 'hit', 'smash'];

function placeholder() {
  const g = new THREE.Group();
  const orange = stylize(new THREE.MeshStandardMaterial({ color: 0xf06a1c, roughness: 0.8 }), { rim: 0.5, key: 'hero' });
  const cream = stylize(new THREE.MeshStandardMaterial({ color: 0xf3e2c4, roughness: 0.8 }), { rim: 0.5, key: 'hero' });
  const leaf = stylize(new THREE.MeshStandardMaterial({ color: 0x5cae3a, roughness: 0.7, emissive: 0x0a3a2a, emissiveIntensity: 0.4 }), { rim: 0.5, key: 'hero' });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.3, 6, 12), orange); body.position.y = 0.45; g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 16, 12), orange); head.position.y = 0.92; g.add(head);
  for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.26, 8), orange); e.position.set(0.13 * s, 1.16, 0); e.rotation.z = -0.25 * s; g.add(e); }
  const tail = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.45, 6, 10), orange); tail.position.set(0, 0.45, 0.35); tail.rotation.x = -1.0; g.add(tail);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), cream); tip.position.set(0, 0.62, 0.58); g.add(tip);
  const board = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.06, 20), leaf); board.scale.set(1, 1, 2.3); board.position.y = 0.03; g.add(board);
  return { root: g, board };
}

export class Hero {
  constructor(scene) {
    this.group = new THREE.Group(); this.group.visible = false; scene.add(this.group);
    const ph = placeholder(); this.model = ph.root; this.group.add(this.model);
    this.mixer = null; this.actions = {};
    this.lean = 0; this.bob = 0; this.t = 0; this.wasAir = false; this.hitT = 0;
    this._m = new THREE.Matrix4(); this._x = new THREE.Vector3(); this._z = new THREE.Vector3();
    if (hasAsset('fox.glb')) loadModel('fox').then((m) => { if (m) this.useModel(m); });
  }

  useModel(m) {
    this.group.remove(this.model);
    this.model = m; this.group.add(m);
    m.traverse((o) => { if (o.isMesh && o.material) { o.material = o.material.clone(); stylize(o.material, { rim: 0.5, key: 'hero-glb' }); o.frustumCulled = false; } });
    const clips = m.userData.animations || m.animations || [];
    if (clips.length) {
      this.mixer = new THREE.AnimationMixer(m);
      for (const c of clips) this.actions[c.name] = this.mixer.clipAction(c);
      const ride = this.actions.ride; if (ride) { ride.play(); ride.weight = 1; }
      for (const k of ['leanL', 'leanR', 'boost']) if (this.actions[k]) { this.actions[k].play(); this.actions[k].weight = 0; }
    }
  }

  // puntual: salto / aterrizaje / golpe
  once(name, fade = 0.08) {
    const a = this.actions[name]; if (!a) return;
    a.reset(); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = false; a.weight = 1; a.fadeIn(fade).play();
  }

  // pos: punto de la superficie bajo el jugador; up: normal del carril; fwd: dirección de avance
  update(visible, pos, up, fwd, omega, air, level, dt) {
    this.group.visible = visible;
    if (!visible) return;
    this.t += dt;
    // inclinación hacia el giro (suavizada), hasta ~32° como la nave de WipEout; al soltar se
    // endereza más despacio (0,3-0,4 s, la sensación de flotar de la tabla de Subway Surfers)
    const target = Math.max(-0.56, Math.min(0.56, -omega * 7));
    this.lean += (target - this.lean) * Math.min(1, dt * (Math.abs(target) > Math.abs(this.lean) ? 12 : 7));
    const x = this._x.crossVectors(fwd, up).normalize();   // derecha
    const z = this._z.copy(fwd).negate();                   // el modelo mira a −Z
    this._m.makeBasis(x, up, z);
    this.group.position.copy(pos);
    this.group.quaternion.setFromRotationMatrix(this._m);
    this.group.rotateZ(this.lean);
    this.group.rotateY(-this.lean * 0.35);
    if (this.mixer) {
      const L = this.actions.leanL, R = this.actions.leanR, B = this.actions.boost;
      if (L) L.weight = Math.max(0, this.lean / 0.56);
      if (R) R.weight = Math.max(0, -this.lean / 0.56);
      if (B) B.weight += ((level >= 3 ? 0.8 : 0) - B.weight) * Math.min(1, dt * 4);
      if (air && !this.wasAir) this.once('jump');
      if (!air && this.wasAir) this.once('land');
      this.mixer.update(dt);
    } else {
      // muñeco: balanceo y tabla que flota
      this.model.position.y = 0.05 + Math.sin(this.t * 7) * 0.02 + (air ? 0.1 : 0);
    }
    this.wasAir = air;
  }

  hit() { this.once('hit'); }
}

export { ANIMS };
