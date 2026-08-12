import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    open: true,
    fs: {
      // The demo imports ../../widget/src and ../../shared directly rather than
      // through a published package, so the dev server has to be allowed to
      // read above its own root. `vite build` resolves these fine on its own;
      // only the dev server enforces this allow-list.
      allow: [repoRoot],
    },
  },
});