// Iluminación estilizada (a la manera del portfolio 2025 de Bruno Simon, y de BotW/Kirby): la
// cara en sombra no se oscurece hacia el negro sino hacia un tono frío y saturado del propio
// color; el paso de luz a sombra es suave; un borde luminoso (fresnel) recorta las formas y la
// oclusión horneada asienta los volúmenes. Se añade a cualquier MeshStandard/Physical sin tocar
// el resto de su sombreado (mapas, niebla, emisión).
import * as THREE from 'three';

export const styleUniforms = {
  uSunDirV: { value: new THREE.Vector3(0, 1, 0) },     // dirección de la luz en espacio de vista
  uSunCol: { value: new THREE.Color(1.15, 1.0, 0.8) },    // sol dorado (concepto C·3)
  uShadowCol: { value: new THREE.Color(0x6d5fc4) },
  uRimCol: { value: new THREE.Color(0xbfe8ff) },
  uStyl: { value: 0.9 },
};

// Encadena con un onBeforeCompile previo (si lo hay).
export function stylize(mat, { rim = 0.35, key = 'st' } = {}) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    Object.assign(sh.uniforms, styleUniforms);
    sh.uniforms.uRimK = { value: rim };
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uSunDirV; uniform vec3 uSunCol; uniform vec3 uShadowCol; uniform vec3 uRimCol; uniform float uStyl; uniform float uRimK;')
      .replace('#include <opaque_fragment>', `{
  vec3 Nv = normalize(normal); vec3 Vv = normalize(vViewPosition);
  float ndl = dot(Nv, normalize(uSunDirV));
  // en un túnel el techo recibe mucha luz rebotada: la sombra no llega nunca al tono puro
  float sh = smoothstep(0.35, -0.35, ndl) * 0.85;
  vec3 base = diffuseColor.rgb;
  // cara al sol: cálida y algo más brillante cuanto más de frente (da volumen a biseles y losas)
  // sombra con color propio (no solo más oscura): el tono frío del mundo tiñe también la luz
  // ambiente, como en la ilustración estilizada
  vec3 shade = base * uShadowCol * 1.02 + uShadowCol * 0.09;
  vec3 st = mix(base * uSunCol * (0.9 + 0.3 * max(ndl, 0.0)), shade, sh);
  #ifdef USE_AOMAP
  st *= mix(1.0, ambientOcclusion, 0.85);
  #endif
  st += uRimCol * pow(1.0 - max(dot(Nv, Vv), 0.0), 3.0) * uRimK * (1.0 - sh * 0.5);
  st += totalEmissiveRadiance;
  outgoingLight = mix(outgoingLight, st, uStyl);
}
#include <opaque_fragment>`);
  };
  const prevKey = mat.customProgramCacheKey ? mat.customProgramCacheKey.bind(mat) : () => '';
  mat.customProgramCacheKey = () => prevKey() + '-' + key;
  return mat;
}
