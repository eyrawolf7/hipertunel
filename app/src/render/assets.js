// Modelos y texturas. En la compilación se incrustan en el HTML (import.meta.glob con ?url y el
// límite de incrustado de Vite al máximo), así el juego sigue siendo un único archivo.
// Nombres relativos a app/src/assets/, sin extensión para los GLB: 'coin', 'kit/tunnel_kit'…
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const urls = import.meta.glob(['../assets/**/*.glb', '../assets/**/*.jpg', '../assets/**/*.png'], { query: '?url', import: 'default', eager: true });
const byName = {};
for (const [path, url] of Object.entries(urls)) byName[path.replace('../assets/', '')] = url;
const loader = new GLTFLoader();
const texLoader = new THREE.TextureLoader();
const cache = {}, tcache = {};

export function loadModel(name) {
  if (!cache[name]) {
    const url = byName[name + '.glb'];
    cache[name] = url ? new Promise((res) => loader.load(url, (g) => res(g.scene), undefined, () => res(null))) : Promise.resolve(null);
  }
  return cache[name];
}

export function loadTexture(name) {
  if (!tcache[name]) {
    const url = byName[name];
    tcache[name] = url ? new Promise((res) => texLoader.load(url, (t) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; res(t); }, undefined, () => res(null))) : Promise.resolve(null);
  }
  return tcache[name];
}

export const hasAsset = (name) => !!byName[name];
