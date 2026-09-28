// Genera hipertunel-movil.html a partir de index.html, sustituyendo los <script src="...cdn..."> por
// el contenido real de node_modules/three. Así solo se mantiene un archivo a mano.
// Uso: npm run build
const fs = require('fs'); const path = require('path');
const raíz = path.join(__dirname, '..');
const three = path.join(raíz, 'node_modules', 'three');
if (!fs.existsSync(three)) { console.error('Falta node_modules/three. Ejecuta antes: npm install'); process.exit(1); }

const src = fs.readFileSync(path.join(raíz, 'index.html'), 'utf8');
const ETIQUETA = /<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/three@[\d.]+\/([^"]+)"><\/script>\n?/g;

let n = 0;
let out = src.replace(ETIQUETA, (_, rel) => {
  const f = path.join(three, rel);
  if (!fs.existsSync(f)) { console.error('No encuentro', rel, 'en node_modules/three'); process.exit(1); }
  n++;
  // </script> dentro del código rompería la etiqueta que lo envuelve
  return '<script>' + fs.readFileSync(f, 'utf8').replace(/<\/script>/g, '<\\/script>') + '</script>\n';
});
if (!n) { console.error('No se sustituyó ninguna librería: ¿han cambiado las URL del CDN?'); process.exit(1); }

// el enlace a la fuente de Google se deja tal cual: si no hay conexión, el CSS ya cae en una de respaldo
out = out.replace('<title>Hipertúnel</title>', '<title>Hipertúnel (móvil)</title>');

fs.writeFileSync(path.join(raíz, 'hipertunel-movil.html'), out);
console.log('hipertunel-movil.html generado:', n, 'librerías incrustadas ·', (out.length / 1024 | 0) + ' KB');
