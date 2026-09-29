// Capa de dibujo: une túnel, cajas, placas, cielo, decorado y posproceso, y coloca la cámara en
// primera persona como el original (pegada a la superficie, mirando a donde va la fila +10).
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { CELL_DEG, LANES } from '../sim/game.js';
import { Track, makeFrame, section, surf, surfSmooth } from './track.js';
import { Tunnel } from './tunnel.js';
import { Boxes } from './boxes.js';
import { Pads } from './pads.js';
import { Sky, setPanoRenderer } from './sky.js';
import { Decor, aerialU } from './decor.js';
import { Fx } from './fx.js';
import { Coins } from './coins.js';
import { Streaks } from './streaks.js';
import { TunnelKit } from './tunnelkit.js';
import { TunnelProps } from './tunnelprops.js';
import { styleUniforms } from './stylize.js';
import { THEMES, BOX_COLORS } from './worlds.js';

const DEG = Math.PI / 180;
const INV_FOG = new THREE.Color(0x0b0822);
const BOOST_BLUE = new THREE.Color(0x3fb6ff).multiplyScalar(2);
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uBlur: { value: 0 }, uFlash: { value: new THREE.Vector4(1, 1, 1, 0) }, uVig: { value: 0.1 }, uCA: { value: 0.0 }, uVigCol: { value: new THREE.Color(0x2b2257) }, uTime: { value: 0 }, uSat: { value: 1.14 }, uCon: { value: 1.12 }, uLo: { value: new THREE.Color(0.95, 0.98, 1.07) }, uHi: { value: new THREE.Color(1.05, 1.0, 0.93) } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uBlur; uniform vec4 uFlash; uniform float uVig; uniform float uCA; uniform float uTime; uniform float uSat; uniform vec3 uVigCol; uniform float uCon; uniform vec3 uLo; uniform vec3 uHi;
    varying vec2 vUv;
    void main(){
      vec2 c = vec2(0.5, 0.52); vec2 d = vUv - c; float r = length(d);
      // desenfoque radial solo en los bordes: el centro, donde miras, queda nítido
      float amt = uBlur * smoothstep(0.18, 0.75, r);
      vec3 acc = vec3(0.0); float tot = 0.0;
      for (int i = 0; i < 5; i++) { float t = float(i) / 4.0; float w = 1.0 - t * 0.6;
        vec2 uv = vUv - d * amt * t;
        acc += vec3(texture2D(tDiffuse, uv + d * uCA).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - d * uCA).b) * w; tot += w; }
      vec3 col = acc / tot;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722)); col = mix(vec3(l), col, uSat);
      col = max(vec3(0.0), (col - 0.18) * uCon + 0.18);                 // contraste alrededor del gris medio (lineal)
      // virado partido: sombras hacia el frío, luces hacia el cálido (luz de tarde estilizada)
      col *= mix(uLo, uHi, smoothstep(0.03, 0.5, dot(col, vec3(0.2126, 0.7152, 0.0722))));
      col = mix(col, col * uVigCol * 1.6, uVig * smoothstep(0.35, 0.95, r * 1.25));
      col = mix(col, uFlash.rgb, uFlash.a);
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class Renderer {
  constructor(canvas, { quality = 'alta' } = {}) {
    this.canvas = canvas;
    this.quality = quality;
    const low = quality === 'baja';
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !low, powerPreference: 'high-performance', stencil: false });
    this.renderer.setClearColor(0xffffff, 1);
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(80, 16 / 9, 0.05, 900);
    this.scene.add(this.camera);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.hemi = new THREE.HemisphereLight(0xffffff, 0xffe8d8, 1.0); this.scene.add(this.hemi);
    this.key = new THREE.DirectionalLight(0xfff4e6, 1.3); this.camera.add(this.key); this.key.position.set(-0.4, 1, 0.6); this.key.target.position.set(0, 0, -1); this.camera.add(this.key.target);

    this.track = new Track();
    this.sky = new Sky(this.scene);
    this.decor = new Decor(this.scene);
    this.tunnel = new Tunnel(this.scene);
    this.kit = new TunnelKit(this.scene);
    this.kit.onReady = () => this.warmup();
    this.props = new TunnelProps(this.scene);
    this.scene.fog = new THREE.Fog(0xffffff, 40, 120);
    this.stoneTint = new THREE.Color(1, 1, 1);
    this.boxes = new Boxes(this.scene);
    this.pads = new Pads(this.scene);
    this.fx = new Fx(this.scene);
    this.coins = new Coins(this.scene);
    this.streaks = new Streaks(this.camera); this.streakKick = 0;
    this.colors = BOX_COLORS.map((h) => new THREE.Color(h));

    this.composer = null;
    this.setQuality(quality);

    this.fr = makeFrame(); this.fr2 = makeFrame(); this.sp = {};
    this.look = new THREE.Vector3(0, 0, -1);
    this.upS = new THREE.Vector3(0, 1, 0);
    this.cam = { shake: 0, shakeDecay: 0, kick: 0, roll: 0, rollAmp: 0, flash: 0, flashCol: new THREE.Color(1, 1, 1), invert: 0, hit: 0 };
    this.themeIdx = 0; this.themeBlend = 1; this.themeFrom = 0;
    this.applyTheme(0, 0, 1);
    this.time = 0;
    this.lean = 0;
    this.warmup();
    this.deathFocus = null;
  }

  setQuality(q) {
    this.quality = q;
    const dpr = Math.min(window.devicePixelRatio || 1, q === 'alta' ? 2 : q === 'media' ? 1.5 : 1);
    this.renderer.setPixelRatio(dpr);
    if (this.composer) { for (const p of this.composer.passes) p.dispose?.(); this.composer.dispose?.(); }
    if (q === 'baja') { this.composer = null; this.bloom = null; this.grade = null; this.resize(); return; }
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: q === 'alta' ? 4 : 0 });
    const comp = new EffectComposer(this.renderer, rt);
    comp.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.45, 1.22);
    comp.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader);
    comp.addPass(this.grade);
    comp.addPass(new OutputPass());
    this.composer = comp;
    this.resize();
  }

  resize() {
    const w = this.canvas.clientWidth || innerWidth, h = this.canvas.clientHeight || innerHeight;
    this.renderer.setSize(w, h, false);
    if (this.composer) { this.composer.setSize(w, h); this.bloom?.setSize(w / 2, h / 2); }
    this.camera.aspect = w / h;
    this.baseFov = fovFor(this.camera.aspect);
    this.camera.fov = this.baseFov;
    this.camera.updateProjectionMatrix();
  }

  reset() { this.track.reset(); this.fx.reset(); this.cam.shake = 0; this.cam.kick = 0; this.cam.roll = 0; this.cam.rollAmp = 0; this.deathFocus = null; this.themeIdx = 0; this.pendingTheme = 0; this.applyTheme(0, 0, 1); this.look.set(0, 0, -1); this.upS.set(0, 1, 0); this.firstFrame = true; }

  applyTheme(from, to, t) {
    const A = THEMES[from % THEMES.length], B = THEMES[to % THEMES.length];
    const c = (k, target) => target.set(A[k]).lerp(new THREE.Color(B[k]), t);
    const u = this.tunnel.uniforms;
    c('base', u.uBase.value); c('base2', u.uBase2.value); c('seam', u.uSeam.value); c('fog', u.uFog.value); c('glow', u.uGlow.value); c('moss', u.uMoss.value);
    u.uDark.value = (A.dark || 0) + ((B.dark || 0) - (A.dark || 0)) * t;
    styleUniforms.uShadowCol.value.set(A.shadow || 0x6d5fc4).lerp(new THREE.Color(B.shadow || 0x6d5fc4), t);
    styleUniforms.uRimCol.value.set(A.rim || 0xbfe8ff).lerp(new THREE.Color(B.rim || 0xbfe8ff), t);
    // sol con el color de cada mundo (dorado, rosado, frío de noche…)
    const ka = A.sunK || [1.15, 1, 0.8], kb = B.sunK || [1.15, 1, 0.8];
    styleUniforms.uSunCol.value.setRGB(ka[0] + (kb[0] - ka[0]) * t, ka[1] + (kb[1] - ka[1]) * t, ka[2] + (kb[2] - ka[2]) * t);
    u.uInvBase.value.set(A.inv || 0x13112a).lerp(new THREE.Color(B.inv || 0x13112a), t);
    this.sky.setTheme(A, B, t);
    this.decor.setTheme(t < 0.5 ? A : B);
    aerialU.uAirCol.value.set(A.fog).lerp(new THREE.Color(B.fog), t);
    this.themeFog = u.uFog.value.clone();
    this.themeGlow = u.uGlow.value.clone();
    this.fogColor = u.uFog.value;
  }

  // Sucesos de la simulación: efectos de cámara y partículas.
  onEvents(events, game) {
    for (const e of events) {
      // el empujón crece con cada nivel: +9°, +12°, +16° de campo de visión
      if (e.type === 'boost') { this.cam.kick = 1; this.cam.kickAmp = [0, 0.75, 1, 1.35][e.level] || 1; this.cam.rollAmp = (Math.random() * 2 - 1) * 0.127; this.cam.roll = 1; this.streakKick = [0, 0.6, 0.8, 1][e.level] || 1; if (e.level === 3) this.cam.blueVig = 0.15; }
      if (e.type === 'crash') {
        const p = this.boxes.positions.get(e.id);
        const bc = this.colors[(game.boxes.find((b) => b.id === e.id) || { color: 0 }).color];
        if (p) this.fx.explode(p, bc, 80, this.look, 60, 1.5);
        this.cam.shake = 0.5; this.cam.shakeDecay = 1.4; this.cam.rollShake = 0.25; this.cam.vigT = 0.15; this.cam.vigCol = bc.clone();
        if (e.fatal) { this.flash(0xff3040, 0.55); this.deathFocus = p ? p.clone() : null; }
        else this.flash(bc.getHex(), 0.3);
        this.cam.hit = 1;
      }
      if (e.type === 'coin') this.coins.collect(game, e, this.track);
      if (e.type === 'foldStart') { this.cam.shake = Math.max(this.cam.shake, 0.12); this.cam.shakeDecay = 0.15; }
      if (e.type === 'foldEnd') { this.flash(0xffffff, 0.3); }
      if (e.type === 'foldStart') this.cam.foldFov = 1.2;
      if (e.type === 'world') {
        // el mundo nuevo se enciende al aterrizar del salto, si lo hay
        if (!game.inverted) this.pendingTheme = (this.pendingTheme || 0) + 1;
      }
    }
  }

  // Compila todos los sombreadores al arrancar (también los ocultos: cielo, decorado, vacío) para
  // que no haya tirones la primera vez que aparece algo.
  warmup() {
    const hidden = [];
    this.scene.traverse((o) => { if (!o.visible) { hidden.push(o); o.visible = true; } });
    try { this.renderer.compile(this.scene, this.camera); } catch (e) {}
    for (const o of hidden) o.visible = false;
    setPanoRenderer(this.renderer);
  }

  // posición en pantalla (px) de una moneda recogida
  coinScreen(e) {
    const fr = makeFrame(); if (!this.track.rings.has(e.k - 1)) return null;
    this.track.frameAt(e.k - 0.5, fr); const sp = {}; const f = this.lastFoldVal ?? 30; surf(section(f), e.lane, f === 30 || f === -30, sp);
    const v = new THREE.Vector3().copy(fr.P).addScaledVector(fr.X, sp.x + sp.nx * 0.85).addScaledVector(fr.U, sp.y + sp.ny * 0.85);
    v.project(this.camera);
    if (v.z > 1) return null;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    return { x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h };
  }

  consumeLanding() { const l = !!this.landed; this.landed = false; return l; }

  flash(hex, a) { this.cam.flashCol.set(hex); this.cam.flash = Math.max(this.cam.flash, a); }

  // s y theta vienen interpolados entre los dos últimos pasos de la simulación
  update(game, s, theta, dt, { reduceFx = false, intro = 0 } = {}) {
    this.time += dt;
    const tr = this.track;
    tr.sync(game);
    // tema
    if (this.themeBlend < 1) { this.themeBlend = Math.min(1, this.themeBlend + dt / 0.25); this.applyTheme(this.themeFrom, this.themeIdx, this.themeBlend); }
    // fase oscura: mientras dura el estado invertido y hasta aterrizar del salto entre mundos
    const gapAhead = game.gaps.find((g) => g.to + 1 > s);
    const landing = gapAhead ? gapAhead.to + 1 : -1;
    if (this.pendingTheme && (!gapAhead || s >= landing - 0.5)) {
      this.themeFrom = this.themeIdx; this.themeIdx += this.pendingTheme; this.pendingTheme = 0; this.themeBlend = 0;
      if (gapAhead || this.wasFlying) { this.flash(THEMES[this.themeIdx % THEMES.length].glow, 0.3); this.landT = 1.5; this.landed = true; }
    }
    this.wasFlying = game.jumpAt(s) > 0.2;
    const inv = game.inverted || (this.pendingTheme > 0) ? 1 : 0;
    // fundido lineal de 0,25 s: sin fotogramas grises a medio camino
    this.cam.invert += Math.sign(inv - this.cam.invert) * Math.min(Math.abs(inv - this.cam.invert), dt * 2.5);
    this.hemi.intensity = 1.0 * (1 - this.cam.invert * 0.7);
    this.tunnel.uniforms.uInvert.value = this.cam.invert;
    // en el tránsito invertido la niebla también se apaga: si no, el túnel oscuro se ve gris
    this.tunnel.uniforms.uFog.value.copy(this.themeFog).lerp(INV_FOG, this.cam.invert);

    // ---- cámara: superficie del jugador + normal, mirando la dirección de la fila +10
    const closed = game.fold === 30 || game.fold === -30;
    const sec = section(game.fold);
    this.lastFoldVal = game.fold;
    const camS = s - 0.12;
    tr.frameAt(camS, this.fr);
    const u = theta / (CELL_DEG * DEG);
    surfSmooth(sec, u, closed, this.sp);
    const sp = this.sp, fr = this.fr;
    const N = new THREE.Vector3().copy(fr.X).multiplyScalar(sp.nx).addScaledVector(fr.U, sp.ny);
    const jump = game.jumpAt(camS);
    const pos = new THREE.Vector3().copy(fr.P).addScaledVector(fr.X, sp.x).addScaledVector(fr.U, sp.y).addScaledVector(N, 0.62 + jump);
    tr.frameAt(Math.min(s + 10, game.kLast), this.fr2);
    const kLook = this.firstFrame ? 1 : Math.min(1, dt * 60 * 0.06);
    this.look.lerp(this.fr2.F, kLook).normalize();
    this.upS.lerp(N, this.firstFrame ? 1 : Math.min(1, dt * 18)).normalize();
    this.firstFrame = false;

    const c = this.cam;
    const cam = this.camera;
    cam.position.copy(pos);
    // travelling de entrada en la cuenta atrás: empieza 1,5 m atrás y abierto, y se acerca
    const iq = intro * intro * (3 - 2 * intro);
    if (iq > 0) cam.position.addScaledVector(this.look, -1.5 * iq).addScaledVector(this.upS, 0.4 * iq);
    if (c.shake > 0) {
      const a = c.shake * (reduceFx ? 0.3 : 1);
      cam.position.x += (Math.random() * 2 - 1) * a; cam.position.y += (Math.random() * 2 - 1) * a; cam.position.z += (Math.random() * 2 - 1) * a;
      c.shake = Math.max(0, c.shake - c.shakeDecay * dt);
    }
    // muerte: la cámara se gira hacia la caja que te ha dado
    const target = new THREE.Vector3().copy(pos).add(this.look);
    if (!game.alive && this.deathFocus) { this.deathT = (this.deathT || 0) + dt; target.lerp(this.deathFocus, Math.min(1, this.deathT * 2) * 0.6); } else this.deathT = 0;
    cam.up.copy(this.upS);
    // giro del impulso (Camera::boostEffect): ±0,127 rad que se apaga
    if (c.roll > 0) { cam.up.applyAxisAngle(this.look, c.rollAmp * c.roll * (reduceFx ? 0.3 : 1)); c.roll = Math.max(0, c.roll - dt * 1.4); }
    // alabeo al girar: unos pocos grados, suavizado; solo sensación, no cambia la mecánica
    this.lean += ((game.alive ? -game.omega * 0.9 : 0) - this.lean) * Math.min(1, dt * 8);
    const leanA = Math.max(-0.07, Math.min(0.07, this.lean)) * (reduceFx ? 0.3 : 1);
    if (leanA) cam.up.applyAxisAngle(this.look, leanA);
    cam.lookAt(target);
    // sacudida de giro del choque (0,08 rad, 0,25 s)
    if (c.rollShake > 0) { cam.rotateZ((Math.random() * 2 - 1) * 0.08 * (c.rollShake / 0.25) * (reduceFx ? 0.3 : 1)); c.rollShake -= dt; }
    // campo de visión: base del original, con un empujón al impulsar
    const sp01 = Math.min(1, Math.max(0, (game.speedMS - 36) / 64));
    const fov = this.baseFov + iq * 18 + sp01 * 14 + easeKick(c.kick) * (reduceFx ? 4 : 12) * (c.kickAmp || 1) + (c.foldFov > 0 ? Math.sin(Math.min(1, (1.2 - c.foldFov) / 1.2) * Math.PI) * 8 : 0);
    if (c.foldFov > 0) c.foldFov -= dt;
    if (!reduceFx && sp01 > 0) cam.rotateZ((Math.random() * 2 - 1) * 0.003 * sp01 * sp01);
    c.kick = Math.max(0, c.kick - dt * 1.8);
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }

    // ---- mundo
    this.tunnel.uniforms.uCam.value.copy(cam.position);
    // sol fijo en el marco de la pista (arriba del tubo, algo a la izquierda y por detrás): el suelo
    // recibe sol cálido y el techo queda en sombra fría de color, así las formas grandes (losas,
    // biseles, arcos) tienen volumen y al girar alrededor del tubo cambia la luz. Una parte sigue a
    // la cámara (la mitad dentro, el 80 % por fuera) para que la cara por la que corres no quede en
    // sombra (legibilidad).
    const right = new THREE.Vector3().crossVectors(this.look, this.upS).normalize();
    const camKey = new THREE.Vector3().copy(this.upS).multiplyScalar(0.85).addScaledVector(this.look, -0.35).addScaledVector(right, -0.4).normalize();
    const trackKey = new THREE.Vector3().copy(fr.U).multiplyScalar(0.8).addScaledVector(fr.X, -0.5).addScaledVector(fr.F, -0.3).normalize();
    const outsideK = game.fold < 29 ? 0.8 : 0.5;         // por fuera, tu cara casi siempre al sol
    this.keyFollow = this.keyFollow === undefined ? outsideK : this.keyFollow + (outsideK - this.keyFollow) * Math.min(1, dt * 1.5);
    this.tunnel.uniforms.uKey.value.copy(trackKey).lerp(camKey, this.keyFollow).normalize();
    cam.updateMatrixWorld();
    styleUniforms.uSunDirV.value.copy(this.tunnel.uniforms.uKey.value).transformDirection(cam.matrixWorldInverse);
    const gapNear = game.gaps.some((g) => g.from - s < 34 && g.to - s > -6);
    const outside = game.fold < 29 || gapNear;
    const fogFar = (outside ? 190 : 120) * (1 + 0.3 * (this.landT > 0 ? this.landT / 1.5 : 0));
    if (this.landT > 0) this.landT -= dt;
    this.tunnel.uniforms.uFogFar.value += (fogFar - this.tunnel.uniforms.uFogFar.value) * Math.min(1, dt * 2);
    this.tunnel.uniforms.uFogNear.value = this.tunnel.uniforms.uFogFar.value * 0.3;
    c.hit = Math.max(0, c.hit - dt * 3);
    this.tunnel.uniforms.uHit.value = c.hit;
    this.tunnel.update(game, tr, this.colors, dt);
    // túnel modelado (kit de Blender) si está cargado y la calidad lo permite
    const useKit = this.kit.ready && this.quality !== 'baja';
    this.tunnel.mesh.visible = !useKit;
    this.kit.setVisible(useKit);
    if (useKit) {
      const dk = Math.max(this.tunnel.uniforms.uDark.value, this.cam.invert);
      this.stoneTint.setRGB(1, 1, 1).lerp(new THREE.Color(0.28, 0.3, 0.45), dk);
      this.kit.update(game, tr, this.colors, this.tunnel.laneGlow, this.stoneTint, dk > 0.5);
    }
    this.props.setVisible(this.quality !== 'baja');
    if (this.quality !== 'baja') this.props.update(game, tr);
    const tu = this.tunnel.uniforms;
    this.scene.fog.color.copy(tu.uFog.value); this.scene.fog.near = tu.uFogNear.value; this.scene.fog.far = tu.uFogFar.value;
    this.boxes.update(game, tr, this.colors, dt, !game.alive && this.deathT > 0 && Math.floor(this.deathT * 10) % 2 ? game.killer : 0, cam.position);
    this.tunnel.uniforms.uOutside.value += ((game.fold < 29 ? 1 : 0) - this.tunnel.uniforms.uOutside.value) * Math.min(1, dt * 2);
    this.tunnel.uniforms.uSkyFill.value.copy(this.sky.u.uTop.value);
    this.streaks.outside = outside;
    this.streaks.update(cam, this.look, this.upS, sp01, this.streakKick, dt, this.fogColor, this.cam.invert);
    this.streakKick = Math.max(0, (this.streakKick || 0) - dt * 1.5);
    this.pads.update(game, tr, dt);
    this.coins.update(game, tr, dt, cam.position);
    this.fx.update(dt);
    this.sky.update(cam, this.fr.U, outside ? 1 : 0, dt, this.cam.invert, this.fr.F);
    this.decor.update(game, tr, cam, true, dt);   // se ve también por los arcos del túnel
    this.renderer.setClearColor(this.fogColor, 1);

    // impulso: 0,4 s de azul eléctrico en juntas y anillos (nunca en los carriles)
    const bk = Math.max(0, c.kick - 0.28) / 0.72;
    this.tunnel.uniforms.uGlow.value.copy(this.themeGlow || this.tunnel.uniforms.uGlow.value).lerp(BOOST_BLUE, bk);
    this.tunnel.uniforms.uRing.value.set(0xfff1c9).lerp(BOOST_BLUE, bk);
    if (this.grade) {
      const g = this.grade.uniforms;
      g.uBlur.value = (0.01 + sp01 * 0.03 + c.kick * 0.06) * (reduceFx ? 0.3 : 1);
      g.uCA.value = c.kick * 0.004;
      g.uVigCol.value.copy(this.fogColor);
      if (c.blueVig > 0) { g.uVigCol.value.lerp(BOOST_BLUE, 0.8); g.uVig.value = 0.45; c.blueVig -= dt; }
      else if (c.vigT > 0) { g.uVigCol.value.copy(c.vigCol).multiplyScalar(1.6); g.uVig.value = 0.5; c.vigT -= dt; }
      else g.uVig.value = 0.1;
      g.uTime.value = this.time;
      g.uFlash.value.set(c.flashCol.r, c.flashCol.g, c.flashCol.b, c.flash * (reduceFx ? 0.4 : 1));
    }
    c.flash = Math.max(0, c.flash - dt * 2.5);
    if (this.bloom) this.bloom.strength = 0.45 + Math.max(this.cam.invert * 0.3, this.tunnel.uniforms.uDark.value * 0.2) + (outside ? 0.1 : 0) + bk * 0.35;
  }

  render() { if (this.composer) this.composer.render(); else this.renderer.render(this.scene, this.camera); }
}

function fovFor(aspect) {
  // El original usa 90° en vertical sobre una pantalla 3:2 apaisada (≈113° en horizontal).
  // Se conserva ese horizontal en cualquier pantalla, sin pasar de 90° en vertical.
  const h = 112 * DEG;
  const v = 2 * Math.atan(Math.tan(h / 2) / aspect) / DEG;
  return Math.min(90, Math.max(60, v));
}
const easeKick = (k) => (k <= 0 ? 0 : Math.sin(Math.min(1, k) * Math.PI * 0.5));
