// Partículas: cascotes de colores cuando atraviesas una caja con impulso y chispas al coger
// monedas. Todo en un InstancedMesh con vida propia; se van en menos de un segundo y salen hacia
// los lados, nunca se quedan delante de la cámara (regla 4).
import * as THREE from 'three';

const MAX = 240;
export class Fx {
  constructor(scene) {
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.4, emissive: 0xffffff, emissiveIntensity: 0.15 }), MAX);
    this.mesh.frustumCulled = false; this.mesh.count = 0;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.mesh);
    this.p = [];
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.s = new THREE.Vector3(); this.e = new THREE.Euler();
  }
  reset() { this.p.length = 0; this.mesh.count = 0; }
  // forward: dirección de avance y velocidad del jugador. Los cascotes salen con nosotros y se
  // abren hacia los lados: así se ven estallar por delante y nunca tapan la vista.
  explode(pos, color, n, forward, speed = 60) {
    for (let i = 0; i < n; i++) {
      if (this.p.length >= MAX) this.p.shift();
      const r = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1);
      if (forward) r.addScaledVector(forward, -r.dot(forward));
      r.normalize().multiplyScalar(5 + Math.random() * 9);
      const v = r.clone();
      if (forward) v.addScaledVector(forward, speed * (1.05 + Math.random() * 0.25));
      const start = pos.clone().add(r.clone().multiplyScalar(0.06));
      if (forward) start.addScaledVector(forward, 2.5);
      this.p.push({ pos: start, v, drag: 1.2, life: 0.55 + Math.random() * 0.4, age: 0, size: 0.07 + Math.random() * 0.16, color: color.clone(), rot: new THREE.Vector3(Math.random() * 9, Math.random() * 9, Math.random() * 9) });
    }
  }
  update(dt) {
    let n = 0;
    for (let i = this.p.length - 1; i >= 0; i--) {
      const p = this.p[i];
      p.age += dt;
      if (p.age >= p.life) { this.p.splice(i, 1); continue; }
      p.pos.addScaledVector(p.v, dt); p.v.multiplyScalar(1 - dt * p.drag);
      const k = 1 - p.age / p.life;
      this.q.setFromEuler(this.e.set(p.rot.x * p.age, p.rot.y * p.age, p.rot.z * p.age));
      this.m.compose(p.pos, this.q, this.s.setScalar(p.size * k));
      this.mesh.setMatrixAt(n, this.m); this.mesh.setColorAt(n, p.color); n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
