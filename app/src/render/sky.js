// Cielo: una esfera que sigue a la cámara con degradado de tres tonos, sol con halo y estrellas
// procedurales. Su "arriba" es el de la pista, suavizado, así al correr por fuera del tubo el cielo
// queda siempre por encima de la carretera.
import * as THREE from 'three';

const vert = /* glsl */`
varying vec3 vDir;
void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position.z = gl_Position.w; }`;
const frag = /* glsl */`
uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uBot; uniform vec3 uSun; uniform vec3 uUp; uniform vec3 uSunDir;
uniform float uStars; uniform float uTime; uniform float uInvert;
varying vec3 vDir;
float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
void main(){
  vec3 d = normalize(vDir);
  float h = dot(d, normalize(uUp));
  vec3 col = h > 0.0 ? mix(uMid, uTop, pow(h, 0.55)) : mix(uMid, uBot, pow(-h, 0.45));
  float sd = max(dot(d, normalize(uSunDir)), 0.0);
  col += uSun * (pow(sd, 900.0) * 3.0 + pow(sd, 24.0) * 0.35 + pow(sd, 4.0) * 0.08);
  // estrellas: celdas de una rejilla en la esfera
  vec3 g = d * 180.0; vec3 id = floor(g); float r = hash(id);
  float st = step(0.985, r) * smoothstep(0.5, 0.0, length(fract(g) - 0.5)) * (0.6 + 0.4 * sin(uTime * 2.0 + r * 40.0));
  col += vec3(st) * uStars * smoothstep(-0.2, 0.3, h);
  vec3 night = mix(vec3(0.02, 0.015, 0.06), vec3(0.09, 0.04, 0.16), smoothstep(-0.3, 0.6, h)) + vec3(st) * 1.2;
  col = mix(col, night, uInvert);
  gl_FragColor = vec4(col, 1.0);
}`;

export class Sky {
  constructor(scene) {
    this.u = {
      uTop: { value: new THREE.Color() }, uMid: { value: new THREE.Color() }, uBot: { value: new THREE.Color() },
      uSun: { value: new THREE.Color() }, uUp: { value: new THREE.Vector3(0, 1, 0) }, uSunDir: { value: new THREE.Vector3(-0.4, 0.5, -1).normalize() },
      uStars: { value: 0 }, uTime: { value: 0 }, uInvert: { value: 0 },
    };
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(800, 48, 24), new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, uniforms: this.u, side: THREE.BackSide, depthWrite: false, fog: false }));
    this.mesh.renderOrder = -10; this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.vis = 0;
    this._c = new THREE.Color();
  }

  setTheme(A, B, t) {
    const u = this.u, c = this._c;
    u.uTop.value.set(A.skyTop).lerp(c.set(B.skyTop), t);
    u.uMid.value.set(A.skyMid).lerp(c.set(B.skyMid), t);
    u.uBot.value.set(A.skyBot).lerp(c.set(B.skyBot), t);
    u.uSun.value.set(A.sun).lerp(c.set(B.sun), t);
    u.uStars.value = A.stars + (B.stars - A.stars) * t;
  }

  update(camera, up, outside, dt, invert) {
    this.mesh.position.copy(camera.position);
    this.u.uUp.value.lerp(up, Math.min(1, dt * 1.5)).normalize();
    this.u.uTime.value += dt;
    this.u.uInvert.value = invert;
    // el cielo solo se ve por fuera o mientras el tubo se abre
    this.vis += ((outside ? 1 : 0) - this.vis) * Math.min(1, dt * 3);
    this.mesh.visible = this.vis > 0.01;
  }
}
