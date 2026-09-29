// Temas visuales. La simulación avanza de mundo en cada plegado; aquí se decide el aspecto.
// Regla 2: el túnel siempre casi neutro, el color vivo es solo para los avisos.
export const THEMES = [
  // Islas del cielo: piedra arenisca clara, musgo, cristales turquesa, cascadas y castillos
  { name: 'Islas del cielo', base: 0xe8d5ad, base2: 0xbfa57a, seam: 0x6b5a3e, fog: 0xbfe0ff, glow: 0x5ff5e0, moss: 0x5fae3a, shadow: 0x9d8fe0, rim: 0xcfeeff, sunK: [1.18, 1.0, 0.78],
    skyTop: 0x3f8fff, skyMid: 0xbfe0ff, skyBot: 0xf4f8ff, sun: 0xfff2c8, stars: 0, decor: 'sky', pano: 'islas' },
  // Selva: piedra más verde y húmeda, niebla verde azulada
  { name: 'Selva perdida', base: 0xe2d8b8, base2: 0xb9ad86, seam: 0x4d5a36, fog: 0xbfe6d0, glow: 0x9dffb0, moss: 0x3f9a2e, shadow: 0x6f9fb8, rim: 0xd8ffe0, sunK: [1.1, 1.06, 0.8],
    skyTop: 0x4aa3d8, skyMid: 0xbfe6d0, skyBot: 0xe8f6e4, sun: 0xfff6d0, stars: 0, decor: 'sky', pano: 'selva' },
  // Noche bioluminiscente: piedra oscura, juntas y cristales cian que brillan
  { name: 'Noche de luciérnagas', base: 0xd8d4e8, base2: 0xa9a4c4, seam: 0x2a2a50, fog: 0x1c2a5e, glow: 0x3ff5e0, moss: 0x2f8f7a, shadow: 0x1a2a60, rim: 0x5ff5e0, sunK: [0.8, 0.95, 1.15],
    skyTop: 0x060a26, skyMid: 0x1c2a5e, skyBot: 0x2f5a7a, sun: 0xbff8ff, stars: 1, decor: 'neon', dark: 1, inv: 0x151b36, pano: 'noche' },
  // Templo al atardecer: arenisca dorada, luz naranja
  { name: 'Templo del ocaso', base: 0xf6dcb0, base2: 0xd6a978, seam: 0x7a4a2e, fog: 0xff9f7a, glow: 0xffd27a, moss: 0x8aa83a, shadow: 0xa86fa8, rim: 0xffd8a0, sunK: [1.26, 0.94, 0.72],
    skyTop: 0x6a4bc4, skyMid: 0xff9f7a, skyBot: 0xffd8a0, sun: 0xffb060, stars: 0.1, decor: 'sky', pano: 'templo' },
  // Volcán: piedra oscura rojiza con vetas de lava
  { name: 'Islas de fuego', base: 0xe8d0c0, base2: 0xb89080, seam: 0x4a2020, fog: 0x8a3040, glow: 0xff8a3d, moss: 0x7a5a2a, shadow: 0x4a1a40, rim: 0xff9a60, sunK: [1.25, 0.86, 0.72],
    skyTop: 0x2a1030, skyMid: 0x8a3040, skyBot: 0xff8a50, sun: 0xffb070, stars: 0.3, decor: 'space', dark: 1, inv: 0x2a1418, pano: 'volcan' },
];

// Colores de caja: 10, como el original, pero sin azul (el azul es solo del impulso).
// 6 tonos bien separados (los 10 colores del original se reparten entre ellos). Nada de amarillo
// ni naranja claro: sobre la arenisca del túnel se confundían con la piedra.
const HUES = [0xff3d57, 0x7cc41a, 0xff5fb4, 0xff6a0a, 0xa05cff, 0x22d08a];
export const BOX_COLORS = Array.from({ length: 10 }, (_, i) => HUES[i % HUES.length]);
