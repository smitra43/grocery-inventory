import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // The preview build is inlined into a single page, so it can't load split chunks.
  build: process.env.VITE_PREVIEW ? { rollupOptions: { output: { inlineDynamicImports: true } } } : {},
  server: {
    host: true,
    proxy: { '/api': 'http://localhost:8787' },
  },
  test: { environment: 'node' },
});
