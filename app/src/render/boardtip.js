// Punta de la tabla de hoja en primera persona: solo la punta, en la franja de abajo de la pantalla
// (~12 % inferior), algo más oscura que el zorro para que no compita con la pista. Nunca tapa el
// centro. Se saca del propio fox.glb: los triángulos que dependen solo del hueso "board".
import * as THREE from 'three';
import { stylize } from './stylize.js';

export class BoardTip {
  constructor(scene) {
    this.group = new THREE.Group(); this.group.visible = false; scene.add(this.group);
    this.ready = false; this.t = 0; this.lean = 0;
    this._f = new THREE.Vector3(); this._u = new THREE.Vector3(); this._r = new THREE.Vector3(); this._m = new THREE.Matrix4();
  }

  // model: la escena de fox.glb (con mallas con esqueleto)
  fromModel(model) {
    model.traverse((o) => {
      if (!o.isSkinnedMesh) return;
      const bi = o.skeleton.bones.findIndex((b) => b.name === 'board');
      if (bi < 0) return;
      const g = o.geometry, si = g.attributes.skinIndex, sw = g.attributes.skinWeight, idx = g.index;
      const onBoard = (v) => { for (let k = 0; k < 4; k++) if (si.getComponent(v, k) === bi && sw.getComponent(v, k) > 0.98) return true; return false; };
      const keep = [];
      const n = idx ? idx.count : g.attributes.position.count;
      for (let i = 0; i < n; i += 3) {
        const a = idx ? idx.getX(i) : i, b = idx ? idx.getX(i + 1) : i + 1, c = idx ? idx.getX(i + 2) : i + 2;
        if (onBoard(a) && onBoard(b) && onBoard(c)) keep.push(a, b, c);
      }
      if (!keep.length) return;
      const ng = new THREE.BufferGeometry();
      for (const name of ['position', 'normal', 'color', 'uv']) if (g.attributes[name]) ng.setAttribute(name, g.attributes[name]);
      ng.setIndex(keep);
      const src = [].concat(o.material)[0];
      const mat = src.clone(); mat.skinning = false;
      if (mat.color) mat.color.multiplyScalar(0.72);          // un 30 % más oscura
      if (src.name === 'crystal') { mat.color?.setHex(0x7fe0c0); mat.emissive?.setHex(0x3fae6a); }   // vena verde, nunca azul
      stylize(mat, { rim: 0.35, key: 'boardtip-' + (src.name || 'm') });
      const me = new THREE.Mesh(ng, mat); me.frustumCulled = false; me.renderOrder = 5;
      this.group.add(me);
    });
    this.ready = this.group.children.length > 0;
    // medidas de la tabla con sus propios vértices (la geometría comparte los del zorro entero)
    let minZ = 0, maxY = 0;
    for (const me of this.group.children) {
      const pos = me.geometry.attributes.position, ix = me.geometry.index;
      for (let i = 0; i < ix.count; i++) { const v = ix.getX(i); minZ = Math.min(minZ, pos.getZ(v)); maxY = Math.max(maxY, pos.getY(v)); }
    }
    this.tipLen = -minZ; this.top = maxY;
  }

  // cam: cámara ya colocada; up: arriba de la pista (upS); omega: giro (se inclina un poco)
  update(visible, cam, up, omega, speed01, dt) {
    this.group.visible = visible && this.ready;
    if (!this.group.visible) return;
    this.t += dt;
    // en el marco de la propia cámara (si no, al cabecear la vista la punta sube y baja)
    const q = cam.quaternion;
    const fw = this._f.set(0, 0, -1).applyQuaternion(q), u = this._u.set(0, 1, 0).applyQuaternion(q), r = this._r.set(1, 0, 0).applyQuaternion(q);
    // la punta se coloca donde cae el 12 % inferior de la pantalla, a D m por delante del ojo; el
    // resto de la tabla queda por debajo, fuera de la vista. Muy cerca del ojo y en miniatura: así
    // nunca se mete bajo el suelo ni la tapa nada.
    const D = 0.42, k = 0.27;                   // k: tamaño respecto al zorro (a 0,42 m se ve como a 1,1 m con 0,7)
    const down = D * 0.68 * Math.tan(cam.fov * Math.PI / 360);
    const bob = Math.sin(this.t * 9) * 0.002 * (0.4 + speed01);
    this.lean += ((-omega * 6) - this.lean) * Math.min(1, dt * 8);
    const lean = Math.max(-0.2, Math.min(0.2, this.lean));
    this.group.position.copy(cam.position).addScaledVector(fw, D - this.tipLen * k).addScaledVector(u, -down - this.top * k + bob).addScaledVector(r, lean * 0.03);
    this._m.makeBasis(r, u, fw.clone().negate());
    this.group.quaternion.setFromRotationMatrix(this._m);
    this.group.rotateZ(lean);
    this.group.scale.setScalar(k);
  }
}
