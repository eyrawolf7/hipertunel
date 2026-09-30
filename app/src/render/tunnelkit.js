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
import { stylize } from './stylize.js';

const MAXI = (ROWS + 4) * (LANES + 2);          // + los dos faldones de la lámina abierta
const SKIRT_H = 1.5;                            // alto del faldón de piedra bajo cada borde
const HALF_W = 1.035, LEN = 4.0;

// colores del anillo tallado y del brillo de las juntas (los pone el render según el mundo)
export const kitU = { uInlay: { value: new THREE.Color(0xffc861) }, uSeamGlow: { value: new THREE.Color(0, 0, 0) } };

function patch(mat, crystal) {
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec3 aC0; attribute vec3 aC1; attribute vec3 aC2; attribute vec3 aC3;
attribute vec3 aN0; attribute vec3 aN1; attribute vec4 aWarn;
varying vec4 vWarn; varying float vFacet; varying float vTile; varying float vKz;
vec3 cellPos(vec3 p, out vec3 Tx, out vec3 Ny, out vec3 Tz){
  // X del kit va de C1 a C0 (no al revés): así la base (X, Y hacia dentro, Z adelante) es
  // dextrógira y la losa no sale reflejada (se verían sus caras de abajo)
  float u = clamp(0.5 - p.x / ${(2 * HALF_W).toFixed(3)}, -0.1, 1.1), v = p.z / ${LEN.toFixed(1)};
  vec3 a = mix(aC0, aC1, u), b = mix(aC3, aC2, u);
  Tx = -normalize(mix(aC1 - aC0, aC2 - aC3, v));
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
vWarn = aWarn; vKz = position.z / ${LEN.toFixed(1)}; vTile = fract(sin(dot(aC0, vec3(12.9898, 78.233, 37.719))) * 43758.5453); vFacet = fract(sin(dot(position.xz, vec2(12.9898, 78.233))) * 43758.5453);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vWarn; varying float vFacet; varying float vTile; varying float vKz;\nuniform float uGlowK; uniform vec3 uInlay; uniform vec3 uSeamGlow;')
      .replace('#include <color_fragment>', crystal ? `#include <color_fragment>
// cristal del aviso: apagado = pastel, encendido = color vivo. El canto claro de la textura
// (vRimC) se aprovecha para que brille el borde de cada panel.
float on = clamp((vWarn.a - 0.42) / 0.58, 0.0, 1.0);
float vRimC = smoothstep(0.8, 0.95, dot(diffuseColor.rgb, vec3(0.3333)));
diffuseColor.rgb *= mix(mix(vWarn.rgb, vec3(1.0), 0.35), vWarn.rgb * mix(vec3(1.0), vWarn.rgb, 0.6), on);` : `#include <color_fragment>
// cada losa con su tono (±6 %) y alguna algo más verdosa, como piedra de verdad
diffuseColor.rgb *= (0.94 + 0.12 * vTile) * mix(vec3(1.0), vec3(0.93, 1.02, 0.9), step(0.82, fract(vTile * 7.13)));
// anillo tallado cada 8 filas (vWarn.x = 1 en esas losas): franja más oscura a ras de la losa con
// una incrustación luminosa en medio. Da el ritmo de C1 sin nada que sobresalga en la calzada.
float isRec = step(1.5, vWarn.x);            // fila de tu récord: franja dorada ancha
float ribBand = min(vWarn.x, 1.0) * (1.0 - isRec) * (1.0 - smoothstep(0.075, 0.09, vKz));
float ribInlay = min(vWarn.x, 1.0) * (1.0 - isRec) * smoothstep(0.022, 0.03, vKz) * (1.0 - smoothstep(0.05, 0.058, vKz));
float recBand = isRec * (smoothstep(0.02, 0.05, vKz) * (1.0 - smoothstep(0.3, 0.33, vKz)) + smoothstep(0.62, 0.65, vKz) * (1.0 - smoothstep(0.95, 0.98, vKz)) * 0.6);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.82, 0.3), recBand * 0.7);
diffuseColor.rgb *= 1.0 - 0.28 * ribBand;
// juntas: máscara sacada de la textura (la junta es lo más oscuro de la losa)
// Aventura: grietas cuando la losa se va a hundir (vWarn.y = desgaste 0..1)
float wearK = smoothstep(0.08, 0.6, vWarn.y);
if (wearK > 0.0) {
  vec2 cq = vMapUv * vec2(7.0, 5.0);
  float c1 = abs(fract(cq.x + 0.35 * sin(cq.y * 2.1)) - 0.5);
  float c2 = abs(fract(cq.y * 0.8 + 0.3 * sin(cq.x * 1.7)) - 0.5);
  float crack = 1.0 - smoothstep(0.0, 0.015 + 0.05 * wearK, min(c1, c2));
  diffuseColor.rgb *= (1.0 - 0.8 * crack * wearK) * (1.0 - 0.25 * wearK);
}
float seamM = (1.0 - smoothstep(0.1, 0.15, dot(texture2D(map, vMapUv).rgb, vec3(0.2126, 0.7152, 0.0722)))) * step(0.13, vMapUv.y);   // solo la cara (las jambas de los arcos usan la franja de arriba del atlas, v < 0,13)
// superficie (vWarn.z: 0 piedra, 1 cristal, 2 musgo, 3 lava, 4 hielo): se lee de lejos por el tono de
// toda la losa, nunca con el color de un carril ni con azul
float sCr = step(0.5, vWarn.z) * step(vWarn.z, 1.5), sMo = step(1.5, vWarn.z) * step(vWarn.z, 2.5), sLa = step(2.5, vWarn.z) * step(vWarn.z, 3.5), sIc = step(3.5, vWarn.z);
float sLum = dot(diffuseColor.rgb, vec3(0.3333));
vec3 sTint = diffuse / max(max(diffuse.r, max(diffuse.g, diffuse.b)), 0.001);   // tinte cálido del mundo: se compensa en cristal y hielo
float sMm = 0.5 + 0.5 * sin(vMapUv.x * 23.0 + vTile * 40.0) * sin(vMapUv.y * 17.0 + vTile * 11.0);
float sOff = smoothstep(0.1, 0.45, length(vViewPosition.xy) / max(abs(vViewPosition.z), 0.001));   // 0 en el centro de la vista
// cristal: losa pulida gris-cian clara; musgo: verde oscuro húmedo con manchas; basalto: gris casi negro; hielo: blanco lechoso
diffuseColor.rgb = mix(diffuseColor.rgb, min(vec3(0.55, 0.78, 0.85) / sTint, vec3(1.3)) * (0.75 + 0.3 * sLum), 0.65 * sCr);
diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(0.22, 0.42, 0.2), vec3(0.1, 0.2, 0.11), sMm) * (0.55 + 0.5 * sLum), 0.88 * sMo);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(sLum) * vec3(0.22, 0.19, 0.19), 0.85 * sLa);
diffuseColor.rgb = mix(diffuseColor.rgb, min(vec3(0.85, 0.91, 0.94) / sTint, vec3(1.3)) * (0.8 + 0.25 * sLum), 0.88 * sIc);
float sSpark = pow(fract(sin(dot(floor(vMapUv * vec2(90.0, 16.0)), vec2(12.9898, 78.233))) * 43758.5453), 48.0) * sOff;`)
      .replace('#include <roughnessmap_fragment>', crystal ? '#include <roughnessmap_fragment>' : `#include <roughnessmap_fragment>
roughnessFactor *= 1.0 - 0.65 * sCr - 0.8 * sIc;`)
      .replace('#include <fog_fragment>', crystal ? '#include <fog_fragment>' : `#ifdef USE_FOG
// las losas con superficie se velan menos con la niebla: el cambio se ve con tiempo
float fogFactor = smoothstep(fogNear, fogFar, vFogDepth) * (1.0 - 0.55 * step(0.5, vWarn.z));
gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
#endif`)
      .replace('#include <emissivemap_fragment>', crystal ? `#include <emissivemap_fragment>
float fresC = pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 3.0);
vec3 glowC = mix(vWarn.rgb, vec3(1.0), 0.35);
totalEmissiveRadiance += (vWarn.rgb * (0.06 + 0.3 * on) + glowC * vRimC * (0.1 + 0.3 * on) + glowC * fresC * (0.08 + 0.15 * on)) * uGlowK;` : `#include <emissivemap_fragment>
totalEmissiveRadiance += uInlay * ribInlay * 1.4 + uSeamGlow * seamM * (1.0 - step(0.5, vWarn.z)) + vec3(1.0, 0.75, 0.2) * recBand * 1.1;
totalEmissiveRadiance += vec3(1.0) * sSpark * 0.6 * sCr + vec3(0.45, 0.06, 0.03) * (seamM * 0.6 + 0.02) * sLa + vec3(0.6, 0.1, 0.04) * pow(fract(sin(dot(floor(vMapUv * 28.0), vec2(39.3468, 11.135))) * 43758.5453), 30.0) * 0.9 * sLa;
diffuseColor.rgb *= 1.0 - 0.6 * seamM * sIc;
totalEmissiveRadiance += vec3(0.1, 0.14, 0.17) * sIc + vec3(0.03, 0.08, 0.09) * sCr;   // la luz cálida del mundo no los vuelve crema`);
    sh.uniforms.uGlowK = mat.userData.uGlowK; sh.uniforms.uInlay = kitU.uInlay; sh.uniforms.uSeamGlow = kitU.uSeamGlow;
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
    this.recordRow = -1;                // fila de tu récord (marca dorada en el túnel)
    this.load();
  }

  async load() {
    const kit = await loadModel('kit/tunnel_kit');
    if (!kit) return;
    const tex = async (n, srgb) => { const t = await loadTexture('kit/' + n); if (t) { t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.flipY = false; t.anisotropy = 8; t.needsUpdate = true; } return t; };
    const [alb, nrm, orm, cn, ca] = await Promise.all([tex('stone_albedo.jpg', true), tex('stone_normal.png'), tex('stone_orm.jpg'), tex('crystal_normal.png'), tex('crystal_albedo.jpg', true)]);
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: alb, normalMap: nrm, aoMap: orm, roughnessMap: orm, roughness: 1, metalness: 0 });
    const crystalMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: ca, normalMap: cn, roughness: 0.15, metalness: 0.0, envMapIntensity: 1.5, vertexColors: true });
    patch(stoneMat, false); patch(crystalMat, true);
    stylize(stoneMat, { rim: 0.06, key: 'kit-stone' }); stylize(crystalMat, { rim: 0.6, key: 'kit-crystal' });
    this.stoneMat = stoneMat; this.crystalMat = crystalMat;
    kit.updateMatrixWorld(true);
    for (const name of ['tile_stone', 'tile_arch', 'tile_crystal', 'tile_crystal_arch']) {
      // un objeto de Blender con dos materiales llega como varias primitivas: se instancian todas y
      // comparten los mismos atributos por instancia (las esquinas de la celda)
      const prims = [];
      const re = new RegExp('^' + name + '(_\\d+)?$');
      kit.traverse((o) => { if (o.isMesh && (re.test(o.name) || (o.parent && o.parent.name === name))) prims.push(o); });
      if (!prims.length) continue;
      const mk = (n) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(MAXI * n), n); a.setUsage(THREE.DynamicDrawUsage); return a; };
      const attrs = { aC0: mk(3), aC1: mk(3), aC2: mk(3), aC3: mk(3), aN0: mk(3), aN1: mk(3), aWarn: mk(4) };
      const list = [];
      for (const o of prims) {
        const g = o.geometry.clone();
        const isCrystal = /crystal/i.test(o.material?.name || '');
        const mat = isCrystal ? crystalMat : stoneMat;
        if (!isCrystal && g.attributes.color) g.deleteAttribute('color');
        if (isCrystal && !g.attributes.color) { const c = new Float32Array(g.attributes.position.count * 3).fill(1); g.setAttribute('color', new THREE.BufferAttribute(c, 3)); }
        for (const [k, a] of Object.entries(attrs)) g.setAttribute(k, a);
        const im = new THREE.InstancedMesh(g, mat, MAXI);
        im.frustumCulled = false; im.count = 0;
        this.scene.add(im); list.push(im);
      }
      this.meshes[name] = { list, attrs };
    }
    this.ready = !!(this.meshes.tile_stone && this.meshes.tile_crystal);
    this.onReady && this.onReady();
  }

  setVisible(v) { for (const m of Object.values(this.meshes)) for (const im of m.list) im.visible = v; }

  // colores de caja (THREE.Color por índice); laneGlow viene del túnel clásico (lo comparte)
  update(game, track, colors, laneGlow, tint, dark) {
    if (!this.ready) return;
    const sec = section(game.fold);
    const lit = game.litStrips();
    const kNear = Math.floor(game.s) - 2;
    const closed = game.fold === 30 || game.fold === -30;
    const cnt = { tile_stone: 0, tile_arch: 0, tile_crystal: 0, tile_crystal_arch: 0 };
    const v = this._v, n = this._n;
    if (this.stoneMat) this.stoneMat.color.copy(tint);
    for (let k = kNear; k <= game.kLast; k++) {
      const ra = track.rings.get(k), rb = track.rings.get(k + 1);
      if (!ra || !rb || game.inGap(k)) continue;
      // un arco cada 4 filas: cada 2 formaban en el punto de fuga una doble fila de teclas de
      // piano blancas que tapaba el centro de la vista
      const archRow = (k & 3) === 0;
      const sf = game.surfaceAt ? game.surfaceAt(k) : 0;      // superficie del Arcade (0 = piedra)
      for (let c = 0; c < LANES; c++) {
        // Aventura: carril hundido (no hay losa: se ve el vacío)
        if (game.isHole && game.isHole(k, c)) continue;
        let wr = 0, wg = 0, wb = 0, wa = 0;
        const strips = lit.get(c);
        if (strips) {
          let best = null;
          for (const st of strips) if (k >= st.from && k <= st.to && (!best || st.id > best.id)) best = st;
          if (best) { const col = colors[best.color]; wr = col.r; wg = col.g; wb = col.b; wa = 0.42 + 0.58 * laneGlow[c]; }
        }
        const name = wa > 0 ? (archRow ? 'tile_crystal_arch' : 'tile_crystal') : (archRow ? 'tile_arch' : 'tile_stone');
        const key = this.meshes[name] ? name : (wa > 0 ? 'tile_crystal' : 'tile_stone');
        const vm = this.meshes[key];
        if (!vm) continue;
        const i = cnt[key]++;
        const g = vm.attrs;
        const b = sec.b, d = sec.d;
        const x0 = b[c * 2], y0 = b[c * 2 + 1], x1 = b[c * 2 + 2], y1 = b[c * 2 + 3];
        toWorld(ra, x0, y0, v); g.aC0.setXYZ(i, v.x, v.y, v.z);
        toWorld(ra, x1, y1, v); g.aC1.setXYZ(i, v.x, v.y, v.z);
        toWorld(rb, x1, y1, v); g.aC2.setXYZ(i, v.x, v.y, v.z);
        toWorld(rb, x0, y0, v); g.aC3.setXYZ(i, v.x, v.y, v.z);
        const nx = -d[c * 2 + 1], ny = d[c * 2];
        n.copy(ra.X).multiplyScalar(nx).addScaledVector(ra.U, ny); g.aN0.setXYZ(i, n.x, n.y, n.z);
        n.copy(rb.X).multiplyScalar(nx).addScaledVector(rb.U, ny); g.aN1.setXYZ(i, n.x, n.y, n.z);
        if (wa > 0) g.aWarn.setXYZW(i, wr, wg, wb, wa); else g.aWarn.setXYZW(i, k === this.recordRow ? 2 : (k & 7) === 0 ? 1 : 0, game.wearAt ? game.wearAt(k, c) : 0, sf, 0);
      }
      // lámina abierta: un faldón de sillería cuelga de cada borde, así la pista tiene grosor de
      // obra (como el anillo del concepto C·3) y no es una cinta de papel. Usa la losa lisa del
      // kit con las esquinas en el borde y 1,5 m por debajo; la base queda dextrógira igual que en
      // la calzada (X = C0 − C1, Y = normal de la cara, Z = adelante).
      if (!closed && this.meshes.tile_stone) {
        const vm = this.meshes.tile_stone, g = vm.attrs, b = sec.b, d = sec.d;
        for (const side of [0, 1]) {
          const c = side ? LANES - 1 : 0;
          const vx = b[side ? LANES * 2 : 0], vy = b[side ? LANES * 2 + 1 : 1];
          const tx = d[c * 2], ty = d[c * 2 + 1], nx = -ty, ny = tx;            // tangente y normal del carril del borde
          const lx = vx - nx * SKIRT_H, ly = vy - ny * SKIRT_H;                  // pie del faldón
          const [ax, ay, bx, by] = side ? [vx, vy, lx, ly] : [lx, ly, vx, vy];   // C0, C1
          const ox = side ? tx : -tx, oy = side ? ty : -ty;                      // hacia fuera de la pista
          const i = cnt.tile_stone++;
          toWorld(ra, ax, ay, v); g.aC0.setXYZ(i, v.x, v.y, v.z);
          toWorld(ra, bx, by, v); g.aC1.setXYZ(i, v.x, v.y, v.z);
          toWorld(rb, bx, by, v); g.aC2.setXYZ(i, v.x, v.y, v.z);
          toWorld(rb, ax, ay, v); g.aC3.setXYZ(i, v.x, v.y, v.z);
          n.copy(ra.X).multiplyScalar(ox).addScaledVector(ra.U, oy); g.aN0.setXYZ(i, n.x, n.y, n.z);
          n.copy(rb.X).multiplyScalar(ox).addScaledVector(rb.U, oy); g.aN1.setXYZ(i, n.x, n.y, n.z);
          g.aWarn.setXYZW(i, 0, 0, 0, 0);
        }
      }
    }
    for (const [key, vm] of Object.entries(this.meshes)) {
      for (const im of vm.list) im.count = cnt[key] || 0;
      for (const a of Object.values(vm.attrs)) a.needsUpdate = true;
    }
    if (this.crystalMat) this.crystalMat.userData.uGlowK.value = dark ? 1.4 : 1;
  }
}
