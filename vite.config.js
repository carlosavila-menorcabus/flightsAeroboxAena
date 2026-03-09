import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  root: 'dashboard-vue',
  base: '/dist/',
  plugins: [vue()],
  build: {
    outDir: '../public/dist',
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      output: {
        entryFileNames: 'assets/app.js',
        chunkFileNames: 'assets/chunk-[hash].js',
        assetFileNames: (assetInfo) => {
          if (assetInfo.name && assetInfo.name.endsWith('.css')) return 'assets/style.css';
          return 'assets/[name]-[hash][extname]';
        }
      }
    }
  }
});
