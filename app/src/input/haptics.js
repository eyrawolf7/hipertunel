// Vibración con intensidad para la app de Android (Capacitor). En la web no hay intensidad: sigue
// siendo navigator.vibrate con el mismo patrón. Dentro de la app cada pulso del patrón se convierte
// en un golpe de Haptics: corto = impact Light, medio = Medium, fuerte = Heavy, y los largos
// (la muerte, el choque) en vibrate con su duración. Las superficies eligen su golpe por nombre:
// piedra Light en cada junta, lava Medium, cristal y hielo un vibrate cortito.
// El patrón es el mismo que recibe navigator.vibrate: [pulso, pausa, pulso...] o un número en ms.
// `plugin` y `timers` se inyectan para poder probarlo sin la app.
export const LIGHT_MAX = 12;      // ms: hasta aquí, impact Light
export const MEDIUM_MAX = 30;     // ms: hasta aquí, impact Medium; más, Heavy
export const LONG_MS = 100;       // ms: desde aquí, vibrate con su duración
export const SHORT_MS = 10;       // duración del vibrate corto del cristal y del hielo

// golpe por nombre de superficie; lo que no está aquí se decide por la duración del pulso
const BY_NAME = {
  piedra: { impact: 'Light' },
  musgo: { impact: 'Light' },
  lava: { impact: 'Medium' },
  cristal: { vibrate: SHORT_MS },
  hielo: { vibrate: SHORT_MS },
};

function hit(ms, name) {
  if (BY_NAME[name]) return BY_NAME[name];
  if (ms >= LONG_MS) return { vibrate: ms };
  return { impact: ms <= LIGHT_MAX ? 'Light' : ms <= MEDIUM_MAX ? 'Medium' : 'Heavy' };
}

export function createHaptics({ plugin = null, web = true, timers = { set: (f, t) => setTimeout(f, t), clear: (id) => clearTimeout(id) }, log = null } = {}) {
  let pending = [];
  const sendWeb = (p) => { try { navigator.vibrate && navigator.vibrate(p); } catch (e) { /* sin API */ } };
  const fire = (h) => {
    if (log) log.push(h);
    try {
      // el enum de Capacitor es 'LIGHT' | 'MEDIUM' | 'HEAVY' (otro texto cae en HEAVY en Android)
      const r = h.impact ? plugin.impact({ style: h.impact.toUpperCase() }) : plugin.vibrate({ duration: h.vibrate });
      if (r && r.catch) r.catch(() => {});
    } catch (e) { /* el plugin no está: no pasa nada */ }
  };
  const cancel = () => { for (const id of pending) timers.clear(id); pending = []; };
  return {
    native: !!plugin,
    // como navigator.vibrate(p): un patrón nuevo corta lo que quedaba del anterior
    play(p, name) {
      if (!plugin) { if (web) sendWeb(p); return; }
      cancel();
      const a = Array.isArray(p) ? p : [p];
      let t = 0;
      for (let i = 0; i < a.length; i++) {
        if (i % 2 === 0 && a[i] > 0) {
          const h = hit(a[i], a.length === 1 ? name : undefined);
          if (t === 0) fire(h); else pending.push(timers.set(() => fire(h), t));
        }
        t += a[i];
      }
    },
    stop() { cancel(); if (web) sendWeb(0); },
  };
}
