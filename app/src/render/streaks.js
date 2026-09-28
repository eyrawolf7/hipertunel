// Líneas de velocidad: trazos finos que pasan zumbando por la periferia de la vista. Van pegados
// a la cámara y nunca entran en el centro de la pantalla (regla 6): solo sugieren velocidad.
import * as THREE from 'three';

const N = 44, D = 9;
export class Streaks {
  constructor(camera) {
    this.pos = new Float32Array(N * 6);
    this.col = new Float32Array(N * 6);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, fog: false });
    this.lines = new THREE.LineSegments(g, this.mat);
    this.lines.frustumCulled = false; this.lines.renderOrder = 20;
    camera.add(this.lines);
    this.d = Array.from({ length: N }, () => this.spawn({}, true));
    this.c = new THREE.Color();
  }

  // Cada trazo es una línea paralela al eje de la vista a una distancia lateral fija: al
  // acercarse se abre hacia el borde. Nace ya en la periferia (radio de pantalla ≥ 0,42).
  spawn(o, init) {
    o.a = Math.random() * Math.PI * 2;
    o.r = 0.55 + Math.random() * 0.5;          // radio en pantalla a la distancia D
    const zStart = -D * o.r / 0.42;
    o.z = init ? zStart + Math.random() * (-zStart - 2) : zStart - Math.random() * 6;
    o.v = 0.8 + Math.random() * 0.5;
    return o;
  }

  update(camera, look, up, sp01, kick, dt, fogColor, invert) {
    const tanV = Math.tan(camera.fov * Math.PI / 360);
    const speed = 60 + sp01 * 120 + kick * 120;
    const len = 2 + sp01 * 9 + kick * 10;
    // blanco en los mundos claros, color del mundo en los oscuros
    const bright = (fogColor.r + fogColor.g + fogColor.b) / 3;
    this.c.set(bright > 0.5 ? 0xffffff : 0xfff1c9);
    // por fuera, sobre el cielo, se tiñen y bajan: si no parecen arañazos
    if (this.outside) this.c.lerp(fogColor, 0.5);
    for (let i = 0; i < N; i++) {
      const o = this.d[i];
      o.z += speed * o.v * dt;
      if (o.z > -2) this.spawn(o, false);
      const z0 = o.z, z1 = Math.min(-1, o.z + len);
      const X = Math.cos(o.a) * o.r * camera.aspect * D * tanV, Y = Math.sin(o.a) * o.r * D * tanV;
      const p = i * 6;
      this.pos[p] = X; this.pos[p + 1] = Y; this.pos[p + 2] = z0;
      this.pos[p + 3] = X; this.pos[p + 4] = Y; this.pos[p + 5] = z1;
      const f = Math.min(1, (z0 + D * o.r / 0.42) / 6);
      for (let j = 0; j < 2; j++) { this.col[p + j * 3] = this.c.r * f; this.col[p + j * 3 + 1] = this.c.g * f; this.col[p + j * 3 + 2] = this.c.b * f; }
    }
    this.lines.geometry.attributes.position.needsUpdate = true;
    this.lines.geometry.attributes.color.needsUpdate = true;
    this.mat.opacity = Math.min(0.55, Math.max(0, sp01 - 0.25) * 0.5 + kick * 0.4) * (1 - invert * 0.3) * (this.outside ? 0.5 : 1);
    this.lines.visible = this.mat.opacity > 0.01;
  }
}
