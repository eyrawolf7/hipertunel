// Túnel con geometría modelada: cada celda es una losa del kit de Blender (piedra, piedra con
// arcos, cristal y cristal con arcos), instanciada y deformada en el sombreador de vértices para
// encajar exactamente en las cuatro esquinas de su celda. Así sigue la geometría de la simulación
// (curvas y plegados) y a la vez tiene el volumen y las texturas horneadas de un juego de verdad.
//
// Convención del kit (ver tools/blender/build_tunnel_kit.py): X ∈ [−1,035, 1,035] a lo ancho,
// Z ∈ [0, 4] a lo largo, Y = altura hacia el interior del tubo.
import * as THREE from 'three';
import { LANES, ROWS } from '../sim/game.js';
import { section, CELL_W, toWorld } from './track.js';
import { ROW_M } from '../sim/game.js';
import { loadModel, loadTexture } from './assets.js';

const MAXI = (ROWS + 4) * LANES;
const HALF_W = 1.035, LEN = 4.0;

function patch(mat, crystal) {
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec3 aC0; attribute vec3 aC1; attribute vec3 aC2; attribute vec3 aC3;
attribute vec3 aN0; attribute vec3 aN1; attribute vec4 aWarn;
varying vec4 vWarn; varying float vFacet;
vec3 cellPos(vec3 p, out vec3 Tx, out vec3 Ny, out vec3 Tz){
  float u = clamp(p.x / ${(2 * HALF_W).toFixed(3)} + 0.5, -0.1, 1.1), v = p.z / ${LEN.toFixed(1)};
  vec3 a = mix(aC0, aC1, u), b = mix(aC3, aC2, u);
  Tx = normalize(mix(aC1 - aC0, aC2 - aC3, v));
  Tz = normalize(b - a);
  Ny = normalize(mix(aN0, aN1, v));
  return mix(a, b, v) + Ny * p.y;
}`)
      .replace('#include <beginnormal_vertex>', `vec3 _tx, _ny, _tz; cellPos(position, _tx, _ny, _tz);
vec3 objectNormal = normalize(_tx * normal.x + _ny * normal.y + _tz * normal.z);
#ifdef USE_TANGENT
vec3 objectTangent = normalize(_tx * tangent.x + _ny * tangent.y + _tz * tangent.z);
#endif`)
      .replace('#include <begin_vertex>', `vec3 transformed = cellPos(position, _tx, _ny, _tz);
vWarn = aWarn; vFacet = fract(sin(dot(position.xz, vec2(12.9898, 78.233))) * 43758.5453);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vWarn; varying float vFacet;\nuniform float uGlowK;')
      .replace('#include <color_fragment>', crystal ? `#include <color_fragment>
// cristal del aviso: apagado = pastel, encendido = color vivo
float on = clamp((vWarn.a - 0.42) / 0.58, 0.0, 1.0);
diffuseColor.rgb *= mix(mix(vWarn.rgb, vec3(1.0), 0.35), vWarn.rgb, on);` : '#include <color_fragment>')
      .replace('#include <emissivemap_fragment>', crystal ? `#include <emissivemap_fragment>
totalEmissiveRadiance += vWarn.rgb * (0.08 + 0.6 * on) * uGlowK;` : '#include <emissivemap_fragment>');
    sh.uniforms.uGlowK = mat.userData.uGlowK;
  };
  mat.userData.uGlowK = { value: 1 };
  mat.customProgramCacheKey = () => (crystal ? 'kit-crystal' : 'kit-stone');
}

export class TunnelKit {
  constructor(scene) {
    this.scene = scene;
    this.ready = false;
    this.meshes = {};
    this._v = new THREE.Vector3(); this._n = new THREE.Vector3();
    this.laneGlow = new Float32Array(LANES);
    this.load();
  }

  async load() {
    const kit = await loadModel('kit/tunnel_kit');
    if (!kit) return;
    const tex = async (n, srgb) => { const t = await loadTexture('kit/' + n); if (t) { t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = 8; } return t; };
    const [alb, nrm, orm, cn] = await Promise.all([tex('stone_albedo.jpg', true), tex('stone_normal.png'), tex('stone_orm.jpg'), tex('crystal_normal.png')]);
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: alb, normalMap: nrm, aoMap: orm, roughnessMap: orm, roughness: 1, metalness: 0 });
    const crystalMat = new THREE.MeshStandardMaterial({ color: 0xffffff, normalMap: cn, roughness: 0.18, metalness: 0.0, envMapIntensity: 1.4 });
    patch(stoneMat, false); patch(crystalMat, true);
    this.stoneMat = stoneMat; this.crystalMat = crystalMat;
    const names = { tile_stone: stoneMat, tile_arch: stoneMat, tile_crystal: crystalMat, tile_crystal_arch: crystalMat };
    kit.updateMatrixWorld(true);
    for (const [name, mat] of Object.entries(names)) {
      let src = null;
      kit.traverse((o) => { if (o.isMesh && (o.name === name || o.parent?.name === name) && !src) src = o; });
      if (!src) continue;
      const g = src.geometry.clone();
      if (g.attributes.uv && !g.attributes.uv1) g.setAttribute('uv1', g.attributes.uv);   // aoMap
      const im = new THREE.InstancedMesh(g, mat, MAXI);
      im.frustumCulled = false; im.count = 0;
      const mk = (n) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(MAXI * n), n); a.setUsage(THREE.DynamicDrawUsage); return a; };
      for (const a of ['aC0', 'aC1', 'aC2', 'aC3', 'aN0', 'aN1']) g.setAttribute(a, mk(3));
      g.setAttribute('aWarn', mk(4));
      this.scene.add(im);
      this.meshes[name] = im;
    }
    this.ready = Object.keys(this.meshes).length >= 2;
    this.onReady && this.onReady();
  }

  setVisible(v) { for (const m of Object.values(this.meshes)) m.visible = v; }

  // colores de caja (THREE.Color por índice); laneGlow viene del túnel clásico (lo comparte)
  update(game, track, colors, laneGlow, tint, dark) {
    if (!this.ready) return;
    const sec = section(game.fold);
    const lit = game.litStrips();
    const kNear = Math.floor(game.s) - 2;
    const cnt = { tile_stone: 0, tile_arch: 0, tile_crystal: 0, tile_crystal_arch: 0 };
    const v = this._v, n = this._n;
    if (this.stoneMat) this.stoneMat.color.copy(tint);
    for (let k = kNear; k <= game.kLast; k++) {
      const ra = track.rings.get(k), rb = track.rings.get(k + 1);
      if (!ra || !rb || game.inGap(k)) continue;
      const archRow = (k & 1) === 0;
      for (let c = 0; c < LANES; c++) {
        let wr = 0, wg = 0, wb = 0, wa = 0;
        const strips = lit.get(c);
        if (strips) {
          let best = null;
          for (const st of strips) if (k >= st.from && k <= st.to && (!best || st.id > best.id)) best = st;
          if (best) { const col = colors[best.color]; wr = col.r; wg = col.g; wb = col.b; wa = 0.42 + 0.58 * laneGlow[c]; }
        }
        const name = wa > 0 ? (archRow ? 'tile_crystal_arch' : 'tile_crystal') : (archRow ? 'tile_arch' : 'tile_stone');
        const im = this.meshes[name] || this.meshes[wa > 0 ? 'tile_crystal' : 'tile_stone'];
        if (!im) continue;
        const key = this.meshes[name] ? name : (wa > 0 ? 'tile_crystal' : 'tile_stone');
        const i = cnt[key]++;
        const g = im.geometry.attributes;
        const b = sec.b, d = sec.d;
        const x0 = b[c * 2], y0 = b[c * 2 + 1], x1 = b[c * 2 + 2], y1 = b[c * 2 + 3];
        toWorld(ra, x0, y0, v); g.aC0.setXYZ(i, v.x, v.y, v.z);
        toWorld(ra, x1, y1, v); g.aC1.setXYZ(i, v.x, v.y, v.z);
        toWorld(rb, x1, y1, v); g.aC2.setXYZ(i, v.x, v.y, v.z);
        toWorld(rb, x0, y0, v); g.aC3.setXYZ(i, v.x, v.y, v.z);
        const nx = -d[c * 2 + 1], ny = d[c * 2];
        n.copy(ra.X).multiplyScalar(nx).addScaledVector(ra.U, ny); g.aN0.setXYZ(i, n.x, n.y, n.z);
        n.copy(rb.X).multiplyScalar(nx).addScaledVector(rb.U, ny); g.aN1.setXYZ(i, n.x, n.y, n.z);
        g.aWarn.setXYZW(i, wr, wg, wb, wa);
      }
    }
    for (const [key, im] of Object.entries(this.meshes)) {
      im.count = cnt[key] || 0;
      const g = im.geometry.attributes;
      for (const a of ['aC0', 'aC1', 'aC2', 'aC3', 'aN0', 'aN1', 'aWarn']) g[a].needsUpdate = true;
    }
    if (this.crystalMat) this.crystalMat.userData.uGlowK.value = dark ? 1.4 : 1;
  }
}
