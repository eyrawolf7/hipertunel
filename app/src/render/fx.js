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
  explode(pos, color, n) {
    for (let i = 0; i < n; i++) {
      if (this.p.length >= MAX) this.p.shift();
      const v = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize().multiplyScalar(6 + Math.random() * 10);
      this.p.push({ pos: pos.clone().add(v.clone().multiplyScalar(0.08)), v, life: 0.6 + Math.random() * 0.5, age: 0, size: 0.18 + Math.random() * 0.35, color: color.clone(), rot: new THREE.Vector3(Math.random() * 6, Math.random() * 6, Math.random() * 6) });
    }
  }
  update(dt) {
    let n = 0;
    for (let i = this.p.length - 1; i >= 0; i--) {
      const p = this.p[i];
      p.age += dt;
      if (p.age >= p.life) { this.p.splice(i, 1); continue; }
      p.pos.addScaledVector(p.v, dt); p.v.multiplyScalar(1 - dt * 1.5);
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
