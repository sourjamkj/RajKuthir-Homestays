import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

// ── Port: only used by the dev/preview server, NOT by `vite build`.
//    Fall back instead of throwing so production builds don't crash.
const rawPort = process.env.PORT;
const port = Number(rawPort) || 5173;

if (rawPort && (Number.isNaN(Number(rawPort)) || Number(rawPort) <= 0)) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// ── Base path: default to root "/" when not provided (e.g. at build time).
const basePath = process.env.BASE_PATH || '/';

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@assets': path.resolve(
        import.meta.dirname,
        '..',
        '..',
        'attached_assets',
      ),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: path.res
