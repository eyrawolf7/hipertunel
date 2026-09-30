// Aventura en pantalla: poderes que flotan sobre su carril y el fantasma de tu mejor intento.
// Ningún poder es azul (el azul es solo del impulso) y todo va a ras del carril, no en el centro.
import * as THREE from 'three';
import { makeFrame, section, surf } from './track.js';

const CENTER = 0.22;   // medio lado del centro protegido, en coordenadas normalizadas de pantalla (el 20 % con margen)

function icon(draw) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  draw(g);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const disc = (g, fill) => { g.fillStyle = '#2b2257'; g.beginPath(); g.arc(64, 64, 60, 0, 7); g.fill(); g.fillStyle = fill; g.beginPath(); g.arc(64, 64, 50, 0, 7); g.fill(); };
const ICONS = {
  magnet: () => icon((g) => { disc(g, '#ff4d5e'); g.strokeStyle = '#fff'; g.lineWidth = 16; g.lineCap = 'butt'; g.beginPath(); g.arc(64, 58, 24, Math.PI, 0, true); g.stroke(); g.fillStyle = '#fff'; g.fillRect(32, 58, 16, 22); g.fillRect(80, 58, 16, 22); g.fillStyle = '#2b2257'; g.fillRect(32, 74, 16, 8); g.fillRect(80, 74, 16, 8); }),
  x2: () => icon((g) => { disc(g, '#ffd23f'); g.fillStyle = '#2b2257'; g.font = 'bold 58px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('×2', 64, 68); }),
  shield: () => icon((g) => { disc(g, '#b58cff'); g.fillStyle = '#fff'; g.beginPath(); g.moveTo(64, 30); g.lineTo(92, 42); g.quadraticCurveTo(90, 82, 64, 98); g.quadraticCurveTo(38, 82, 36, 42); g.closePath(); g.fill(); }),
  // marca del fantasma del Arcade: anillo crema con contorno violeta oscuro y centro suave (se lee sobre túneles claros y oscuros)
  ghostArc: () => icon((g) => {
    g.lineCap = 'round';
    g.strokeStyle = 'rgba(43,34,87,0.75)'; g.lineWidth = 17; g.beginPath(); g.arc(64, 64, 42, 0, 7); g.stroke();
    g.strokeStyle = 'rgba(255,246,224,1)'; g.lineWidth = 9; g.beginPath(); g.arc(64, 64, 42, 0, 7); g.stroke();
    const r = g.createRadialGradient(64, 64, 2, 64, 64, 34);
    r.addColorStop(0, 'rgba(255,246,224,0.55)'); r.addColorStop(1, 'rgba(255,246,224,0)');
    g.fillStyle = r; g.beginPath(); g.arc(64, 64, 34, 0, 7); g.fill();
  }),
  ghost: () => icon((g) => {
    const r = g.createRadialGradient(64, 64, 4, 64, 64, 62);
    r.addColorStop(0, 'rgba(255,255,255,0.95)'); r.addColorStop(0.35, 'rgba(255,240,200,0.55)'); r.addColorStop(1, 'rgba(255,240,200,0)');
    g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  }),
};

export class AdvView {
  constructor(scene) {
    this.scene = scene;
    this.tex = {}; for (const k in ICONS) this.tex[k] = ICONS[k]();
    this.pool = [];
    for (let i = 0; i < 4; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex.x2, depthWrite: false, fog: false })); s.visible = false; s.scale.setScalar(1.3); scene.add(s); this.pool.push(s); }
    this.ghost = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex.ghost, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    this.ghost.visible = false; this.ghost.scale.setScalar(1.6); scene.add(this.ghost);
    this.fr = makeFrame(); this.sp = {}; this.t = 0; this._ndc = new THREE.Vector3(); this._dir = new THREE.Vector3(); this._view = new THREE.Vector3(); this._ray = new THREE.Vector3(); this.ghostInfo = null; this._arcLook = false;
  }

  place(track, game, s, lane, out, up) {
    const k0 = Math.floor(s);
    if (!track.rings.has(k0) || !track.rings.has(k0 + 1)) return false;
    track.frameAt(s, this.fr);
    const closed = game.fold === 30 || game.fold === -30;
    surf(section(game.fold), lane, closed, this.sp);
    const fr = this.fr, sp = this.sp;
    out.copy(fr.P).addScaledVector(fr.X, sp.x + sp.nx * up).addScaledVector(fr.U, sp.y + sp.ny * up);
    return true;
  }

  // Marca del fantasma del Arcade. En el túnel todo lo que está a más de ~8 filas cae en el centro de la
  // vista, y el centro no se toca: la marca sale por donde iría el fantasma (su carril y su fila) pero
  // empujada en línea recta hacia fuera hasta quedar fuera del 20 % central (con margen por el brillo del
  // bloom), con un tamaño fijo en pantalla que crece un poco al acercarse. Como es una marca en pantalla, se
  // dibuja sin profundidad (no la tapa la pared del túnel). Devuelve false si queda detrás de la cámara.
  pinGhost(camera, gap) {
    const p = this.ghost.position, v = this._ndc.copy(p).project(camera);
    if (v.z < -1 || v.z > 1) return false;
    const r = 0.05 + 0.04 * (1 - Math.min(1, gap / 30));                      // radio: fracción de la mitad del alto
    const nx = CENTER + 1.7 * r / camera.aspect + 0.03, ny = CENTER + 1.7 * r + 0.03;
    let x = v.x, y = v.y;
    if (Math.abs(x) < 1e-4 && Math.abs(y) < 1e-4) y = -1e-3;                    // justo delante: hacia el suelo
    const inside = Math.abs(x) < nx && Math.abs(y) < ny;
    if (inside) { const k = Math.min(nx / Math.abs(x || 1e-9), ny / Math.abs(y || 1e-9)); x *= k; y *= k; }
    const f = camera.getWorldDirection(this._dir);
    const depth = Math.max(0.5, -this._view.copy(p).applyMatrix4(camera.matrixWorldInverse).z);
    this._ray.set(x, y, 0.5).unproject(camera).sub(camera.position).normalize();
    p.copy(camera.position).addScaledVector(this._ray, depth / Math.max(0.2, this._ray.dot(f)));
    this.ghost.scale.setScalar(2 * r * depth * Math.tan(camera.fov * Math.PI / 360));
    this.ghostInfo = { pinned: inside, natural: { x: v.x, y: v.y }, r };
    return true;
  }

  update(game, track, dt, ghost, camera) {
    this.t += dt;
    const adv = game.mode === 'adventure';
    const arc = game.variant === 'arcade' && !game.hero;
    let n = 0;
    if (adv) {
      for (const p of game.pickups) {
        if (p.got || p.k < game.s - 1 || p.k > game.kLast || n >= this.pool.length) continue;
        const sp = this.pool[n];
        if (!this.place(track, game, p.k - 0.5, p.lane, sp.position, 1.0 + 0.15 * Math.sin(this.t * 4 + p.k))) continue;
        if (sp.material.map !== this.tex[p.kind]) { sp.material.map = this.tex[p.kind]; sp.material.needsUpdate = true; }
        sp.visible = true; n++;
      }
    }
    for (let i = n; i < this.pool.length; i++) this.pool[i].visible = false;
    // fantasma: a ras del carril por el que iba en su mejor intento, si está a la vista
    this.ghost.visible = false; this.ghostInfo = null;
    if (adv && ghost && ghost.alive !== undefined && ghost.s > game.s + 0.6 && ghost.s < game.kLast - 1) {
      const lane = ghost.theta / (Math.PI / 6);
      if (this.place(track, game, ghost.s, lane, this.ghost.position, 0.5)) {
        this.ghost.visible = true;
        this.ghost.material.opacity = 0.75 + 0.25 * Math.sin(this.t * 6);
        // crece con la distancia: a 20 filas sigue leyéndose
        this.ghost.scale.setScalar(1.8 + (ghost.s - game.s) * 0.22);
      }
    } else if (arc && ghost && ghost.alive && ghost.s > game.s + 0.6 && ghost.s < game.kLast - 2) {
      // Arcade: dónde ibas tú en tu mejor partida (nunca en el centro). Entra y sale con fundido
      const lane = ghost.theta / (Math.PI / 6), gap = ghost.s - game.s;
      if (this.place(track, game, ghost.s, lane, this.ghost.position, 0.5) && this.pinGhost(camera, gap)) {
        const fade = Math.min(1, (gap - 0.6) / 3, (game.kLast - 2 - ghost.s) / 8);
        this.ghost.visible = true; this.ghost.material.opacity = (0.85 + 0.1 * Math.sin(this.t * 6)) * Math.max(0, fade);
      }
    }
    const m = this.ghost.material, look = arc && this.ghost.visible;
    m.depthTest = !look; this.ghost.renderOrder = look ? 10 : 0;
    if (look !== this._arcLook && (look || adv)) {   // Aventura: brillo aditivo; Arcade: anillo normal
      this._arcLook = look; m.map = look ? this.tex.ghostArc : this.tex.ghost;
      m.blending = look ? THREE.NormalBlending : THREE.AdditiveBlending; m.needsUpdate = true;
    }
  }
}
