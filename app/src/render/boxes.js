// Cajas: un InstancedMesh de cubos redondeados con barniz. Las fijas ocupan una fila; las de una
// colección recta se tocan y forman una barra. Los cubos rodantes vuelcan sobre su arista hacia
// el carril de al lado (60° dentro del tubo, 120° por fuera), como en el original.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { LANES, ROW_M, M_PER_UNIT, SHORT_H } from '../sim/game.js';
import { section, surf, CELL_W, R, makeFrame } from './track.js';
import { stylize } from './stylize.js';
import { loadModel, loadTexture } from './assets.js';

const MAX = 40;
const DEG = Math.PI / 180;

const KIT_SUB = 12;

export class Boxes {
  constructor(scene, envMap) {
    this.geo = new RoundedBoxGeometry(1, 1, 1, 3, 0.14);
    this.mat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff, roughness: 0.26, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.08,
      envMapIntensity: 0.4, emissive: 0x000000,
    });
    // brillo propio: sube cuando estás en su carril (Box+0x1c del original)
    this.mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aGlow;\nvarying float vGlow;\nvarying float vUpY;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow; vUpY = position.y;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vGlow;\nvarying float vUpY;')
        // degradado de color: arriba más claro, abajo hacia un tono más profundo (sombra de color, no gris)
        .replace('#include <color_fragment>', '#include <color_fragment>\nfloat gy = clamp(vUpY + 0.5, 0.0, 1.0);\ndiffuseColor.rgb *= mix(vec3(0.62, 0.55, 0.78), vec3(1.1), gy);')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * (0.05 + 0.3 * vGlow);\n// luz de borde blanca: separa la caja de un carril de su mismo color\ntotalEmissiveRadiance += vec3(pow(1.0 - saturate(dot(normalize(vNormal), normalize(vViewPosition))), 2.0)) * 0.35;');
    };
    stylize(this.mat, { rim: 0.45, key: 'box' });
    this.mesh = new THREE.InstancedMesh(this.geo, this.mat, MAX);
    // contorno oscuro (casco invertido): deja las cajas recortadas como en un juego de Switch y
    // las separa del fondo claro
    this.outlineMat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(0x3a1f5c) }, uW: { value: 0.06 } },
      vertexShader: 'uniform float uW; void main(){ vec3 p = position + normal * uW / vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz)); gl_Position = projectionMatrix * viewMatrix * instanceMatrix * vec4(p, 1.0); }',
      fragmentShader: 'uniform vec3 uColor; void main(){ gl_FragColor = vec4(uColor, 1.0); }',
      side: THREE.BackSide,
    });
    this.outline = new THREE.InstancedMesh(this.geo, this.outlineMat, MAX);
    this.outline.instanceMatrix = null;
    this.glow = new Float32Array(MAX);
    this.geo.setAttribute('aGlow', new THREE.InstancedBufferAttribute(this.glow, 1).setUsage(THREE.DynamicDrawUsage));
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
    this.outline.instanceMatrix = this.mesh.instanceMatrix;
    // sombra de contacto: una mancha suave bajo cada caja, que la asienta en el túnel
    const sg = new THREE.PlaneGeometry(1, 1); sg.rotateX(-Math.PI / 2);
    this.shadow = new THREE.InstancedMesh(sg, new THREE.ShaderMaterial({
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * viewMatrix * instanceMatrix * vec4(position, 1.0); }',
      fragmentShader: 'varying vec2 vUv; void main(){ vec2 q = (vUv - 0.5) * 2.0; float d = length(q * vec2(1.0, 0.8)); float a = (1.0 - smoothstep(0.35, 1.0, d)) * 0.38; gl_FragColor = vec4(0.1, 0.08, 0.19, a); }',
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    }), MAX);
    this.shadow.frustumCulled = false; this.shadow.count = 0; this.shadow.renderOrder = 1;
    this.shadow.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.shadow);
    this.sm = new THREE.Matrix4(); this.sp2 = new THREE.Vector3(); this.ssc = new THREE.Vector3();
    this.types = new Uint8Array(MAX); this.dims = new Float32Array(MAX * 3); this.cols = []; this._rc = new THREE.Color();
    this.loadKit(scene);
    this.nShadow = 0;
    this.outline.frustumCulled = false; this.outline.count = 0;
    scene.add(this.outline);
    this.fr = makeFrame();
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.sc = new THREE.Vector3();
    this.T = new THREE.Vector3(); this.N = new THREE.Vector3(); this.B = new THREE.Vector3(); this.p = new THREE.Vector3();
    this.sp = {}; this.col = new THREE.Color();
    this.glowBy = new Map();
    this.positions = new Map();     // id -> Vector3 (para explosiones y cámara de muerte)
  }

  // Cajas del kit: bloque de piedra teñido del color de la caja con runa luminosa (fijas) y cubo
  // de cristal tallado (rodantes). Si no cargan, quedan las cajas redondeadas de siempre.
  async loadKit(scene) {
    const kit = await loadModel('kit/boxes_kit');
    if (!kit) return;
    const tex = async (n, srgb) => { const t = await loadTexture('kit/' + n); if (t) { t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.flipY = false; t.needsUpdate = true; } return t; };
    const [alb, nrm, orm, cn] = await Promise.all([tex('stone_albedo.jpg', true), tex('stone_normal.png'), tex('stone_orm.jpg'), tex('crystal_normal.png')]);
    const stone = stylize(new THREE.MeshStandardMaterial({ map: alb, normalMap: nrm, aoMap: orm, roughnessMap: orm, roughness: 1 }), { rim: 0.45, key: 'box-stone' });
    const rune = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const crystal = stylize(new THREE.MeshStandardMaterial({ normalMap: cn, roughness: 0.12, envMapIntensity: 1.6, vertexColors: true, emissive: 0x000000 }), { rim: 0.7, key: 'box-crystal' });
    const make = (name) => {
      const out = [];
      kit.updateMatrixWorld(true);
      kit.traverse((o) => {
        if (!o.isMesh || !(o.name === name || o.name.startsWith(name + '_') || o.parent?.name === name)) return;
        const g = o.geometry.clone();
        const mn = (o.material?.name || '').toLowerCase();
        const mat = mn.includes('rune') ? rune : mn.includes('crystal') ? crystal : stone;
        if (mat !== crystal && g.attributes.color) g.deleteAttribute('color');
        if (g.attributes.uv && !g.attributes.uv1) g.setAttribute('uv1', g.attributes.uv);
        g.computeBoundingBox(); const bb = g.boundingBox, sz = new THREE.Vector3(); bb.getSize(sz);
        const im = new THREE.InstancedMesh(g, mat, MAX * KIT_SUB); im.frustumCulled = false; im.count = 0;
        im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        im.userData.isRune = mat === rune;
        scene.add(im); out.push(im);
      });
      return out;
    };
    this.kitBlock = make('box_block'); this.kitCrystal = make('box_crystal');
    if (this.kitBlock.length) this.mesh.visible = false;
  }

  update(game, track, colors, dt, flashId, camPos) {
    const sec = section(game.fold);
    const closed = game.fold === 30 || game.fold === -30;
    const on = game.playerStrips();
    const { fr, m, T, N, B, p, sc, sp } = this;
    let n = 0, ns = 0;
    this.positions.clear();
    for (const b of game.boxes) {
      if (b.hit || n >= MAX) continue;
      const tall = b.tall && game.fold > 26;
      // colocación a lo largo, cuadrada con las ventanas de choque del original: la caja corta
      // se centra en su anillo (choca de k−0,5 a k+1), el pilar medio carril antes (de k−1 a k)
      const sMid = tall ? b.k - 0.5 : b.k;
      if (!track.rings.has(Math.floor(sMid)) || !track.rings.has(Math.floor(sMid) + 1)) continue;
      track.frameAt(sMid, fr);
      surf(sec, b.lane, closed, sp);
      const tx = sp.tx, ty = sp.ty;
      const nx = -ty, ny = tx;
      T.copy(fr.X).multiplyScalar(tx).addScaledVector(fr.U, ty);
      N.copy(fr.X).multiplyScalar(nx).addScaledVector(fr.U, ny);
      B.copy(fr.F).negate();
      const cx = sp.x, cy = sp.y;
      // un pelín más ancha que el carril: la caja choca a ±22,5°, más que el medio carril (15°)
      const w = CELL_W * (b.fixed ? 1.02 : 1.1);
      let h = tall ? 2 * R * Math.cos(Math.PI / LANES) - 0.02 : (b.tall ? R : SHORT_H * M_PER_UNIT);
      const len = ROW_M * (b.joined ? 1.02 : 0.9);
      h *= b.grow < 1 ? easeOut(b.grow) : 1;
      // volteo del rodante sobre su arista
      let ox = 0, oy = h / 2, rot = 0;
      if (!b.fixed && b.roll !== 0) {
        const dir = Math.sign(b.roll);
        const psi = -Math.abs(b.roll) * DEG * dir;      // horario hacia la derecha
        const px = dir * w / 2;                           // arista pivote, en (t, n)
        const vx = -dir * w / 2, vy = h / 2;
        const c = Math.cos(psi), s = Math.sin(psi);
        ox = px + vx * c - vy * s; oy = vx * s + vy * c;
        rot = psi;
      }
      p.copy(fr.P).addScaledVector(fr.X, cx).addScaledVector(fr.U, cy).addScaledVector(T, ox).addScaledVector(N, oy);
      m.makeBasis(T, N, B);
      if (rot) m.multiply(new THREE.Matrix4().makeRotationZ(rot));
      sc.set(w, h, len);
      m.scale(sc); m.setPosition(p);
      this.mesh.setMatrixAt(n, m);
      if (!tall && ns < MAX) {
        this.sp2.copy(fr.P).addScaledVector(fr.X, cx).addScaledVector(fr.U, cy).addScaledVector(N, 0.025);
        this.sm.makeBasis(T, N, B).scale(this.ssc.set(w * 1.45, 1, len * 1.3)).setPosition(this.sp2);
        this.shadow.setMatrixAt(ns++, this.sm);
      }
      const want = on.includes(b.lane) || (b.opp >= 0 && on.includes(b.opp)) ? 1 : 0;
      const g0 = this.glowBy.get(b.id) || 0;
      const g1 = g0 + (want - g0) * Math.min(1, (want > g0 ? 10 : 5) * dt);
      this.glowBy.set(b.id, g1);
      this.glow[n] = g1;
      if (flashId === b.id) { this.mesh.setColorAt(n, this.col.setRGB(1, 1, 1)); this.glow[n] = 2; }
      else this.mesh.setColorAt(n, colors[b.color]);
      this.types[n] = b.fixed ? 0 : 1;
      this.dims[n * 3] = w; this.dims[n * 3 + 1] = h; this.dims[n * 3 + 2] = len;
      this.positions.set(b.id, p.clone());
      // con invulnerabilidad atraviesas las cajas: la que tienes encima no debe llenar la pantalla
      if (game.invul > 0 && camPos && p.distanceToSquared(camPos) < 9) { this.mesh.setMatrixAt(n, m.makeScale(0, 0, 0)); }
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.outline.count = n;
    if (this.kitBlock && this.kitBlock.length) {
      let nb = 0, nc = 0;
      const tm = new THREE.Matrix4(), tc = new THREE.Color(), sub = new THREE.Matrix4(), cm = new THREE.Matrix4();
      for (let i = 0; i < n; i++) {
        this.mesh.getMatrixAt(i, tm); this.mesh.getColorAt(i, tc);
        const list = this.types[i] === 0 ? this.kitBlock : (this.kitCrystal.length ? this.kitCrystal : this.kitBlock);
        // la pieza del kit es un cubo: una caja alargada (o un pilar) se monta con varios bloques
        // casi cúbicos apilados, en vez de estirar uno (la runa saldría deformada)
        const w = this.dims[i * 3], hh = this.dims[i * 3 + 1], ll = this.dims[i * 3 + 2];
        const nH = Math.max(1, Math.min(4, Math.round(hh / w))), nL = Math.max(1, Math.min(3, Math.round(ll / w)));
        for (let a = 0; a < nH; a++) for (let c = 0; c < nL; c++) {
          const j = list === this.kitBlock ? nb++ : nc++;
          sub.makeScale(1, 1 / nH, 1 / nL).setPosition(0, (a + 0.5) / nH - 0.5, (c + 0.5) / nL - 0.5);
          cm.multiplyMatrices(tm, sub);
          for (const im of list) {
            im.setMatrixAt(j, cm);
            // la runa brilla con el color de la caja (más cuanto más cerca estás de su carril)
            if (im.userData.isRune) im.setColorAt(j, this._rc.copy(tc).multiplyScalar(1.6 + this.glow[i] * 1.4));
            else im.setColorAt(j, tc);
          }
        }
      }
      for (const im of this.kitBlock) { im.count = nb; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; }
      for (const im of this.kitCrystal) { im.count = nc; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; }
    }
    this.shadow.count = ns; this.shadow.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.geo.attributes.aGlow.needsUpdate = true;
    if (this.glowBy.size > 200) { const live = new Set(game.boxes.map((b) => b.id)); for (const id of this.glowBy.keys()) if (!live.has(id)) this.glowBy.delete(id); }
  }
}

const easeOut = (t) => 1 - Math.pow(1 - t, 3);
