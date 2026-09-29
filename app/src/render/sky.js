// Cielo: una esfera que sigue a la cámara con degradado de tres tonos, sol con halo y estrellas
// procedurales. Su "arriba" es el de la pista, suavizado, así al correr por fuera del tubo el cielo
// queda siempre por encima de la carretera.
import * as THREE from 'three';
const Z = new THREE.Vector3(0, 0, 1);
// panoramas de 360° de cada mundo (equirectangulares), si existen
const PANOS = import.meta.glob('../assets/sky/*.jpg', { query: '?url', import: 'default', eager: true });
const panoUrl = (name) => { for (const [p, u] of Object.entries(PANOS)) if (p.endsWith('/' + name + '.jpg')) return u; return null; };
const loader = new THREE.TextureLoader();
const texCache = {};
function panoTex(name) {
  if (!name) return null;
  if (texCache[name] !== undefined) return texCache[name];
  const u = panoUrl(name); if (!u) return (texCache[name] = null);
  const t = loader.load(u); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.minFilter = THREE.LinearFilter; t.generateMipmaps = false;
  return (texCache[name] = t);
}

const vert = /* glsl */`
varying vec3 vDir;
void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position.z = gl_Position.w; }`;
const frag = /* glsl */`
uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uBot; uniform vec3 uSun; uniform vec3 uUp; uniform vec3 uSunDir;
uniform float uStars; uniform float uTime; uniform float uInvert;
uniform sampler2D uPanoA; uniform sampler2D uPanoB; uniform float uHasA; uniform float uHasB; uniform float uPanoT; uniform vec3 uFwd;
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
  // panorama del mundo, orientado con el 'arriba' de la pista
  vec3 up = normalize(uUp); vec3 fw = normalize(uFwd - up * dot(uFwd, up)); vec3 rt = cross(fw, up);
  float lon = atan(dot(d, rt), dot(d, fw)); float lat = asin(clamp(h, -1.0, 1.0));
  vec2 puv = vec2(lon / 6.2831853 + 0.5, 0.5 + lat / 3.14159265);
  vec3 pa = texture2D(uPanoA, puv).rgb, pb = texture2D(uPanoB, puv).rgb;
  vec3 pano = mix(pa, pb, uPanoT); float hasP = mix(uHasA, uHasB, uPanoT);
  col = mix(col, pano * 1.05 + uSun * pow(sd, 900.0) * 2.0, hasP);
  vec3 night = mix(vec3(0.02, 0.015, 0.06), vec3(0.09, 0.04, 0.16), smoothstep(-0.3, 0.6, h)) + vec3(st) * 1.2;
  col = mix(col, night, uInvert);
  gl_FragColor = vec4(col, 1.0);
}`;

// Mar de nubes: un disco enorme muy por debajo de la pista con nubes procedurales (fbm) que
// avanzan despacio. Da horizonte y profundidad a las fases por fuera sin tocar la carretera.
const seaVert = /* glsl */`
varying vec2 vP; varying float vD;
void main(){ vP = position.xy; vec4 w = modelMatrix * vec4(position, 1.0); vD = length(position.xy);
  gl_Position = projectionMatrix * viewMatrix * w; }`;
const seaFrag = /* glsl */`
uniform vec3 uA; uniform vec3 uB; uniform vec3 uFogC; uniform float uTime; uniform float uAlpha; uniform vec2 uOff;
varying vec2 vP; varying float vD;
float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * n2(p); p *= 2.03; a *= 0.5; } return s; }
void main(){
  vec2 p = (vP + uOff) / 180.0;
  float c = fbm(p + vec2(uTime * 0.01, 0.0));
  float puff = smoothstep(0.38, 0.72, c);
  vec3 col = mix(uB, uA, puff);
  float fade = smoothstep(1500.0, 300.0, vD);
  col = mix(uFogC, col, fade);
  gl_FragColor = vec4(col, uAlpha * smoothstep(1600.0, 900.0, vD));
}`;

export class Sky {
  constructor(scene) {
    this.u = {
      uTop: { value: new THREE.Color() }, uMid: { value: new THREE.Color() }, uBot: { value: new THREE.Color() },
      uSun: { value: new THREE.Color() }, uUp: { value: new THREE.Vector3(0, 1, 0) }, uSunDir: { value: new THREE.Vector3(-0.4, 0.5, -1).normalize() },
      uStars: { value: 0 }, uTime: { value: 0 }, uInvert: { value: 0 },
      uPanoA: { value: null }, uPanoB: { value: null }, uHasA: { value: 0 }, uHasB: { value: 0 }, uPanoT: { value: 0 }, uFwd: { value: new THREE.Vector3(0, 0, -1) },
    };
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(800, 48, 24), new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, uniforms: this.u, side: THREE.BackSide, depthWrite: false, fog: false }));
    this.mesh.renderOrder = -10; this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.seaU = { uA: { value: new THREE.Color(0xffffff) }, uB: { value: new THREE.Color(0xc9dcff) }, uFogC: { value: new THREE.Color() }, uTime: { value: 0 }, uAlpha: { value: 0 }, uOff: { value: new THREE.Vector2() } };
    this.sea = new THREE.Mesh(new THREE.CircleGeometry(1600, 48), new THREE.ShaderMaterial({ vertexShader: seaVert, fragmentShader: seaFrag, uniforms: this.seaU, transparent: true, depthWrite: false, fog: false }));
    this.sea.renderOrder = -9; this.sea.frustumCulled = false;
    scene.add(this.sea);
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
    const ta = panoTex(A.pano), tb = panoTex(B.pano);
    u.uPanoA.value = ta || tb; u.uPanoB.value = tb || ta; u.uHasA.value = ta ? 1 : 0; u.uHasB.value = tb ? 1 : 0; u.uPanoT.value = t;
    // nubes: blancas en los mundos de día, teñidas del horizonte en los de noche
    const night = (A.stars + (B.stars - A.stars) * t) > 0.5;
    this.seaU.uA.value.copy(u.uBot.value).lerp(c.set(0xffffff), night ? 0.25 : 0.85);
    this.seaU.uB.value.copy(u.uMid.value).lerp(u.uBot.value, 0.5).multiplyScalar(night ? 0.7 : 0.95);
    this.seaU.uFogC.value.copy(u.uMid.value);
  }

  update(camera, up, outside, dt, invert, fwd) {
    if (fwd) this.u.uFwd.value.lerp(fwd, Math.min(1, dt * 1.5));
    this.mesh.position.copy(camera.position);
    this.u.uUp.value.lerp(up, Math.min(1, dt * 1.5)).normalize();
    this.u.uTime.value += dt;
    this.u.uInvert.value = invert;
    // el túnel de piedra tiene arcos abiertos: el cielo se ve siempre
    this.vis = 1;
    this.mesh.visible = true;
    // el mar va 110 m por debajo, perpendicular al "arriba" del cielo, y se desliza con la cámara
    const skyUp = this.u.uUp.value;
    this.sea.position.copy(camera.position).addScaledVector(skyUp, -110);
    this.sea.quaternion.setFromUnitVectors(Z, skyUp);
    this.seaU.uOff.value.set(camera.position.x, -camera.position.z);
    this.seaU.uTime.value += dt;
    // con panorama el mar de nubes sobra: el panorama ya trae su horizonte (islas, selva…)
    const u = this.u, hasP = u.uHasA.value + (u.uHasB.value - u.uHasA.value) * u.uPanoT.value;
    this.seaU.uAlpha.value = this.vis * (1 - invert) * (1 - hasP);
    this.sea.visible = this.seaU.uAlpha.value > 0.01;
  }
}
