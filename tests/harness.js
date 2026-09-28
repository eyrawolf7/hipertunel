// Arnés para ejecutar la lógica del juego en Node (sin GPU): stubs mínimos de DOM y WebGL.
const fs = require('fs'); const path = require('path'); const THREE = require('three');
// load()                      -> index.html con los valores por defecto
// load({ warns: 0.9 })        -> los mismos parámetros que se pasarían por la URL, para probar variantes
module.exports = function load(arg, file = path.join(__dirname, '..', 'index.html')) {
  if (typeof arg === 'string') { file = arg; arg = null; }
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(arg || {})) if (v !== undefined && v !== null && v !== '') qs.set(k, v);
  global.location = { search: qs.toString() ? '?' + qs.toString() : '' };
  const html = fs.readFileSync(file, 'utf8');
  const code = html.match(/<script id="game">([\s\S]*?)<\/script>/)[1];
  const grad = { addColorStop(){} };
  const ctx = new Proxy({}, { get(t, p){ if (p in t) return t[p]; if (/Gradient/.test(p)) return () => grad; return () => {}; }, set(t, p, v){ t[p] = v; return true; } });
  const el = () => ({ style: {}, classList: { add(){}, remove(){}, toggle(){}, contains(){ return false; } }, hidden: false, textContent: '', innerHTML: '', offsetWidth: 1, addEventListener(){}, setPointerCapture(){}, getContext: () => ctx, width: 1, height: 1 });
  const els = {};
  global.document = { getElementById: (id) => els[id] || (els[id] = el()), createElement: () => el(), querySelectorAll: () => [el(), el(), el()], addEventListener(){}, hidden: false, documentElement: el() };
  global.window = global; global.innerWidth = 1280; global.innerHeight = 720; global.devicePixelRatio = 1;
  global.addEventListener = () => {}; global.matchMedia = () => ({ matches: false });
  Object.defineProperty(global, 'navigator', { value: { getGamepads: () => [] }, configurable: true });
  const store = {}; Object.defineProperty(global, 'localStorage', { value: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } }, configurable: true });
  global.requestAnimationFrame = () => 1; global.isSecureContext = true;
  class FakeRenderer { constructor(){ this.capabilities = { getMaxAnisotropy: () => 1 }; } setPixelRatio(){} setSize(){} setClearColor(){} render(){} }
  THREE.WebGLRenderer = FakeRenderer; global.THREE = THREE;
  eval(code);
  return window.__game;
};
