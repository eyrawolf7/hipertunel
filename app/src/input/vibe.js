// Vibración de la superficie: un pulso corto en cada "junta" del camino, con un ritmo propio por
// superficie (piedra, cristal, musgo, lava, hielo) y un pulso más largo al cambiar de una a otra.
// No toca la simulación: solo lee qué superficie se nota. El reloj y `vibrate` se inyectan para
// poder probarlo sin navegador. Nunca hay menos de MIN_GAP ms entre el arranque de dos pulsos; el
// motor (engineRumble de main.js) pide hueco con tryPulse() y cede si acaba de sonar uno.
export const MIN_GAP = 50;        // ms mínimos entre pulsos
export const CHANGE_MS = 20;      // pulso al cambiar de superficie

// ms del pulso y rango [min, max] de ms entre pulsos (igual = regular)
export const PATTERNS = [
  { name: 'piedra', ms: 10, min: 90, max: 140 },    // variación suave en cada junta
  { name: 'cristal', ms: 6, min: 60, max: 60 },     // regular, finito
  { name: 'musgo', ms: 7, min: 110, max: 170 },     // amortiguado
  { name: 'lava', ms: 14, min: 150, max: 300 },     // grave e irregular
  { name: 'hielo', ms: 5, min: 450, max: 450 },     // casi nada
];

export function createVibe(vibrate, rnd = Math.random) {
  let lastStart = -Infinity, next = 0, surface = -1, changePending = false;
  const log = [];
  // `vibrate` puede devolver false si no deja salir el pulso (tope de pulsos por segundo): entonces no cuenta
  // `name` (piedra, lava, cambio...) solo la usa la app de Android para elegir el golpe de Haptics
  const fire = (now, ms, kind = 'suelo', name) => {
    if (now - lastStart < MIN_GAP) return false;
    let ok;
    try { ok = vibrate(ms, kind, name); } catch (e) { /* sin API de vibración */ }
    if (ok === false) return false;
    lastStart = now;
    log.push({ t: now, ms, kind });
    return true;
  };
  return {
    log,
    // una vez por fotograma. on = partida en marcha, viva y con la vibración activada.
    update(now, { on, surface: s = 0 }) {
      if (!on) { surface = -1; changePending = false; return; }
      const p = PATTERNS[s] || PATTERNS[0];
      if (surface < 0) { surface = s; next = now + p.min; return; }          // sin pulso al empezar
      if (s !== surface) { surface = s; changePending = true; }
      if (changePending) {                                                   // pulso de cambio (espera si acaba de sonar otro)
        if (fire(now, CHANGE_MS, 'suelo', 'cambio')) { changePending = false; next = now + p.min; }
        return;
      }
      // el siguiente se ancla al calendario (no al fotograma en que salió) para que la media sea la pedida
      if (now >= next && fire(now, p.ms, 'suelo', p.name)) next = Math.max(now, next + p.min + rnd() * (p.max - p.min));
    },
    // el motor pide un pulso suelto; false si no cabe
    tryPulse(now, ms) { return fire(now, ms, 'motor'); },
    reset() { lastStart = -Infinity; surface = -1; changePending = false; log.length = 0; },
  };
}
