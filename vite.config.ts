import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), 'ui');

export default defineConfig({
  root,
  base: './',
  plugins: [
    react(),
    {
      // A szállított index.html szigorú CSP-t hordoz (connect-src 'none'), ami
      // fejlesztés alatt a Vite HMR websocketjét is blokkolná. Csak dev módban
      // engedjük fel — a build kimenete érintetlen marad.
      name: 'szivecske-dev-csp',
      apply: 'serve' as const,
      transformIndexHtml(html: string) {
        return html.replace("connect-src 'none'", "connect-src 'self' ws://localhost:5273");
      },
    },
  ],
  build: {
    outDir: join(root, '..', 'dist', 'ui'),
    emptyOutDir: true,
  },
  server: { port: 5273, strictPort: true },
});
