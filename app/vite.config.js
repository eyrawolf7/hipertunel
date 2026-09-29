import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { fileURLToPath } from 'node:url';

// La raíz de Vite es app/. La compilación sale en un único HTML autocontenido (dist/index.html),
// que tools/publicar.mjs copia a la raíz del repo para GitHub Pages y como archivo para compartir.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  plugins: [viteSingleFile()],
  build: {
    outDir: fileURLToPath(new URL('../dist', import.meta.url)),
    emptyOutDir: true,
    target: 'es2020',
    assetsInlineLimit: 100000000,
    chunkSizeWarningLimit: 4000,
  },
  server: { port: +(process.env.HIP_PORT || 5173), strictPort: true },
});
