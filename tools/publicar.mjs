// Copia la compilación de un solo archivo a la raíz: index.html (lo que sirve GitHub Pages) y
// hipertunel-movil.html (el archivo para pasar por WhatsApp o abrir en local).
import { readFileSync, writeFileSync } from 'node:fs';
const html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
writeFileSync(new URL('../index.html', import.meta.url), html);
writeFileSync(new URL('../hipertunel-movil.html', import.meta.url), html);
console.log('Publicado index.html y hipertunel-movil.html ·', (html.length / 1024 | 0) + ' KB');
