import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      // Dev requests go through Vite so the browser only ever talks to one origin.
      // `changeOrigin` rewrites Host to the server's loopback address, which is what
      // the server's host allowlist expects; the browser's Origin is forwarded as-is
      // and is allowlisted separately.
      '/api': {
        target: 'http://127.0.0.1:5174',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ''),
      },
    },
  },
});
