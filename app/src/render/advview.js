// Aventura en pantalla: poderes que flotan sobre su carril y el fantasma de tu mejor intento.
// Ningún poder es azul (el azul es solo del impulso) y todo va a ras del carril, no en el centro.
import * as THREE from 'three';
import { makeFrame, section, surf } from './track.js';

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
    this.fr = makeFrame(); this.sp = {}; this.t = 0;
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

  update(game, track, dt, ghost) {
    this.t += dt;
    const adv = game.mode === 'adventure';
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
    this.ghost.visible = false;
    if (adv && ghost && ghost.alive !== undefined && ghost.s > game.s + 0.6 && ghost.s < game.kLast - 1) {
      const lane = ghost.theta / (Math.PI / 6);
      if (this.place(track, game, ghost.s, lane, this.ghost.position, 0.5)) {
        this.ghost.visible = true;
        this.ghost.material.opacity = 0.75 + 0.25 * Math.sin(this.t * 6);
        // crece con la distancia: a 20 filas sigue leyéndose
        this.ghost.scale.setScalar(1.8 + (ghost.s - game.s) * 0.22);
      }
    }
  }
}
