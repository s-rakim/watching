import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: {
    // pdf.js's legacy build has the polyfills iOS before 17.4 and older Firefox ESR need.
    // Aliasing the bare import swaps it in everywhere without touching each file.
    alias: [{ find: /^pdfjs-dist$/, replacement: 'pdfjs-dist/legacy/build/pdf.mjs' }],
  },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8080' },
  },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  optimizeDeps: { esbuildOptions: { target: 'es2022' } },
});
