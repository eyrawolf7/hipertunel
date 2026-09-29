// Piezas pintadas de la interfaz (app/src/assets/ui/<nombre>.png|webp).
// Cada pieza que exista se publica en la raíz de la interfaz como variable CSS --img-<nombre>
// (url incrustada en la compilación) y como clase .has-<nombre>. El CSS solo usa la pieza bajo
// .htui.has-<nombre>; si falta el archivo no pasa nada y se queda el dibujo en CSS.
// Los cortes (9-slice) de cada pieza están en ui.css, sección «piezas pintadas».
const files = import.meta.glob('../assets/ui/*.{png,webp}', { query: '?url', import: 'default', eager: true });

export const PIECES = {};
for (const [path, url] of Object.entries(files)) {
  const name = path.split('/').pop().replace(/\.(png|webp)$/, '');
  // si hay .png y .webp de la misma pieza, gana el .webp
  if (!PIECES[name] || path.endsWith('.webp')) PIECES[name] = url;
}

export function applySkin(root) {
  for (const [name, url] of Object.entries(PIECES)) {
    root.style.setProperty(`--img-${name}`, `url("${url}")`);
    root.classList.add(`has-${name}`);
  }
  return Object.keys(PIECES);
}
