// Temas visuales. La simulación avanza de mundo en cada plegado; aquí se decide el aspecto.
// Regla 2: el túnel siempre casi neutro, el color vivo es solo para los avisos.
export const THEMES = [
  { name: 'Cielo', base: 0xfffaf2, base2: 0xd4d0e6, seam: 0x2a2350, fog: 0xffe2c0, glow: 0xffd27a,
    skyTop: 0x2f7fff, skyMid: 0x8fc8ff, skyBot: 0xfff3e0, sun: 0xfff2c8, stars: 0, decor: 'sky', exposure: 1.0 },
  { name: 'Atardecer', base: 0xfbe9e0, base2: 0xe9d3d6, seam: 0x6a4a78, fog: 0xff9c86, glow: 0xffb27a,
    skyTop: 0x5b3fb8, skyMid: 0xff8f8f, skyBot: 0xffd6a0, sun: 0xffb060, stars: 0.15, decor: 'sky', exposure: 1.0 },
  { name: 'Noche de neón', base: 0xf4f2fb, base2: 0xd9d7e6, seam: 0x3a3170, fog: 0x2b1f63, glow: 0xff6ad5,
    skyTop: 0x07051f, skyMid: 0x2d1670, skyBot: 0x8a3bb8, sun: 0xff9ae8, stars: 1, decor: 'neon', exposure: 0.95, dark: 1, inv: 0x1a1236 },
  { name: 'Aurora', base: 0xf5fbf8, base2: 0xdde6e3, seam: 0x2e5a5f, fog: 0x0f3342, glow: 0x3fe0a0,
    skyTop: 0x020d1c, skyMid: 0x0f4d5a, skyBot: 0x3fb8a0, sun: 0xc8fff0, stars: 1, decor: 'space', exposure: 0.95, dark: 1, inv: 0x0b2a2e },
  { name: 'Caramelo', base: 0xfdeaf3, base2: 0xeed8e6, seam: 0x7a4a6c, fog: 0xff9fd0, glow: 0xff9ecf,
    skyTop: 0x7ec8ff, skyMid: 0xffd0ea, skyBot: 0xfff6e0, sun: 0xfff8e0, stars: 0, decor: 'sky', exposure: 1.0 },
  { name: 'Galaxia', base: 0xf5f3fb, base2: 0xdcd9e8, seam: 0x3a3270, fog: 0x120c33, glow: 0xc58bff,
    skyTop: 0x03010f, skyMid: 0x1b0f45, skyBot: 0x4b2b8f, sun: 0xffe6ff, stars: 1, decor: 'space', exposure: 0.95, dark: 1, inv: 0x150c2e },
];

// Colores de caja: 10, como el original, pero sin azul (el azul es solo del impulso).
// 6 tonos bien separados (los 10 colores del original se reparten entre ellos)
const HUES = [0xff3d57, 0xffc21a, 0xff5fb4, 0xff8a1a, 0xa05cff, 0x22d08a];
export const BOX_COLORS = Array.from({ length: 10 }, (_, i) => HUES[i % HUES.length]);
