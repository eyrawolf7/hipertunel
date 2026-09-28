// Modelos GLB. En la compilación se incrustan en el HTML (import.meta.glob con ?url y el límite
// de incrustado de Vite al máximo), así el juego sigue siendo un único archivo.
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const urls = import.meta.glob('../assets/*.glb', { query: '?url', import: 'default', eager: true });
const byName = {};
for (const [path, url] of Object.entries(urls)) byName[path.split('/').pop().replace('.glb', '')] = url;
const loader = new GLTFLoader();
const cache = {};

export function loadModel(name) {
  if (!cache[name]) {
    const url = byName[name];
    cache[name] = url ? new Promise((res) => loader.load(url, (g) => res(g.scene), undefined, () => res(null))) : Promise.resolve(null);
  }
  return cache[name];
}
