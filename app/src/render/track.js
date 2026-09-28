// Geometría del túnel a partir del estado de la simulación.
// Cada fila k tiene un anillo: centro P, adelante F, arriba U y derecha X (transporte paralelo,
// así el túnel no se retuerce solo). La sección es un polígono de 12 caras de ancho fijo que se
// abre anclado en el carril 0, igual que Tunnel::reshape del original: con 30° por celda es un
// tubo cerrado, con 0° una lámina plana y con −30° un tubo por el que corres por fuera.
import * as THREE from 'three';
import { LANES, M_PER_UNIT, R_UNITS, ROW_M } from '../sim/game.js';

export const R = R_UNITS * M_PER_UNIT;                 // 4 m
export const CELL_W = 2 * R * Math.sin(Math.PI / LANES);
const DEG = Math.PI / 180;

export class Track {
  constructor() { this.rings = new Map(); this.minK = 0; }

  reset() { this.rings.clear(); }

  // Se llama tras cada paso de la simulación: crea los anillos nuevos y olvida los viejos.
  sync(game) {
    for (const row of game.rows) {
      if (this.rings.has(row.k)) continue;
      const prev = this.rings.get(row.k - 1);
      const F = new THREE.Vector3(
        Math.sin(row.yaw * DEG) * Math.cos(row.pitch * DEG),
        Math.sin(row.pitch * DEG),
        -Math.cos(row.yaw * DEG) * Math.cos(row.pitch * DEG)).normalize();
      let P, U;
      if (prev) {
        P = prev.P.clone().addScaledVector(prev.F, ROW_M);
        U = prev.U.clone().addScaledVector(F, -prev.U.dot(F)).normalize();
      } else {
        P = new THREE.Vector3(0, 0, -row.k * ROW_M);
        U = new THREE.Vector3(0, 1, 0).addScaledVector(F, -F.y).normalize();
      }
      const X = new THREE.Vector3().crossVectors(F, U).normalize();
      this.rings.set(row.k, { k: row.k, P, F, U, X });
    }
    const k0 = game.kFirst - 4;
    for (const k of this.rings.keys()) if (k < k0) this.rings.delete(k);
    this.minK = k0;
  }

  // Anillo interpolado en una posición continua s (en filas).
  frameAt(s, out) {
    const k = Math.floor(s), t = s - k;
    const a = this.rings.get(k) || this.rings.get(k + 1) || this.last();
    const b = this.rings.get(k + 1) || a;
    out.P.lerpVectors(a.P, b.P, t);
    out.F.lerpVectors(a.F, b.F, t).normalize();
    out.U.lerpVectors(a.U, b.U, t);
    out.U.addScaledVector(out.F, -out.U.dot(out.F)).normalize();
    out.X.crossVectors(out.F, out.U).normalize();
    return out;
  }

  last() { let m = null; for (const r of this.rings.values()) if (!m || r.k > m.k) m = r; return m; }
}

export const makeFrame = () => ({ P: new THREE.Vector3(), F: new THREE.Vector3(), U: new THREE.Vector3(), X: new THREE.Vector3() });

// Sección 2D (x a la derecha, y hacia arriba) para un pliegue dado. Devuelve los 13 vértices de
// borde b[0..12] y la dirección de cada celda.
export function section(fold) {
  const a = fold * DEG;
  const b = new Float32Array(26), d = new Float32Array(24);
  const y0 = -R * Math.cos(Math.PI / LANES);
  b[0] = -CELL_W / 2; b[1] = y0;
  for (let i = 0; i < LANES; i++) {
    const c = Math.cos(i * a), s = Math.sin(i * a);
    d[i * 2] = c; d[i * 2 + 1] = s;
    b[(i + 1) * 2] = b[i * 2] + CELL_W * c;
    b[(i + 1) * 2 + 1] = b[i * 2 + 1] + CELL_W * s;
  }
  return { b, d, fold };
}

// Punto de la superficie para una posición lateral u (en carriles: el carril i ocupa
// [i − 0,5, i + 0,5]) y su normal hacia "arriba" del jugador. Suaviza la normal cerca de las
// aristas para que la cámara no dé tirones al cambiar de cara.
export function surf(sec, u, closed, out) {
  if (closed) u = ((u + 0.5) % LANES + LANES) % LANES - 0.5;
  let c = Math.floor(u + 0.5);
  if (c < 0) c = 0; if (c > LANES - 1) c = LANES - 1;
  const t = u - (c - 0.5);
  const { b, d } = sec;
  out.x = b[c * 2] + d[c * 2] * CELL_W * t;
  out.y = b[c * 2 + 1] + d[c * 2 + 1] * CELL_W * t;
  const blendW = 0.3;
  let nx = -d[c * 2 + 1], ny = d[c * 2];
  const edge = t < blendW ? c - 1 : t > 1 - blendW ? c + 1 : -99;
  if (edge !== -99) {
    const e = closed ? (edge + LANES) % LANES : edge;
    if (e >= 0 && e < LANES) {
      const w = 0.5 - 0.5 * (t < blendW ? t / blendW : (1 - t) / blendW);
      nx = nx * (1 - w) + -d[e * 2 + 1] * w;
      ny = ny * (1 - w) + d[e * 2] * w;
      const l = Math.hypot(nx, ny); nx /= l; ny /= l;
    }
  }
  out.nx = nx; out.ny = ny;
  out.tx = d[c * 2]; out.ty = d[c * 2 + 1];
  return out;
}

export const toWorld = (fr, x, y, v) => v.copy(fr.P).addScaledVector(fr.X, x).addScaledVector(fr.U, y);
