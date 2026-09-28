// Temas visuales. La simulación avanza de mundo en cada plegado; aquí se decide el aspecto.
// Regla 2: el túnel siempre casi neutro, el color vivo es solo para los avisos.
export const THEMES = [
  { name: 'Cielo', base: 0xfbf6ef, base2: 0xd3d8ec, seam: 0x2f2a63, fog: 0xfff4e2, glow: 0x7fd0ff,
    skyTop: 0x2f7fff, skyMid: 0x8fc8ff, skyBot: 0xfff3e0, sun: 0xfff2c8, stars: 0, decor: 'sky', exposure: 1.0 },
  { name: 'Atardecer', base: 0xfff1e6, base2: 0xf3cfc6, seam: 0x6a3558, fog: 0xffd2b5, glow: 0xffb27a,
    skyTop: 0x5b3fb8, skyMid: 0xff8f8f, skyBot: 0xffd6a0, sun: 0xffb060, stars: 0.15, decor: 'sky', exposure: 1.0 },
  { name: 'Noche de neón', base: 0xeeeaff, base2: 0xb7b0ea, seam: 0x241c4f, fog: 0x2b1f63, glow: 0xff6ad5,
    skyTop: 0x07051f, skyMid: 0x2d1670, skyBot: 0x8a3bb8, sun: 0xff9ae8, stars: 1, decor: 'neon', exposure: 0.95 },
  { name: 'Aurora', base: 0xeefff8, base2: 0xb3e3d8, seam: 0x163f46, fog: 0x0f3342, glow: 0x3fe0a0,
    skyTop: 0x020d1c, skyMid: 0x0f4d5a, skyBot: 0x3fb8a0, sun: 0xc8fff0, stars: 1, decor: 'space', exposure: 0.95 },
  { name: 'Caramelo', base: 0xfff6fb, base2: 0xf6d2e6, seam: 0x6b2d5c, fog: 0xffe3f0, glow: 0xff9ecf,
    skyTop: 0x7ec8ff, skyMid: 0xffd0ea, skyBot: 0xfff6e0, sun: 0xfff8e0, stars: 0, decor: 'sky', exposure: 1.0 },
  { name: 'Galaxia', base: 0xf0eeff, base2: 0xc2bdf0, seam: 0x1c1640, fog: 0x120c33, glow: 0x8f7bff,
    skyTop: 0x03010f, skyMid: 0x1b0f45, skyBot: 0x4b2b8f, sun: 0xffe6ff, stars: 1, decor: 'space', exposure: 0.95 },
];

// Colores de caja: 10, como el original, pero sin azul (el azul es solo del impulso).
export const BOX_COLORS = [0xff3d57, 0xffd21a, 0xff5fb4, 0xff8a1a, 0xd84dff, 0x9b5cff, 0x22e0a6, 0xff2d78, 0x9be024, 0x1fd05f];
