import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3015',
        changeOrigin: true,
        ws: false
      },
      '/ws': {
        target: 'ws://127.0.0.1:3015',
        changeOrigin: true,
        ws: true
      }
    }
  },
  build: {
    outDir: '../dist/dashboard',
    emptyOutDir: true
  }
});