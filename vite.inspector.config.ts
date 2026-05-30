import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  build: {
    lib: {
      entry: 'src/server/inspector/entry.ts',
      formats: ['iife'],
      name: 'TrellisDbInspector',
      fileName: () => 'inspector.js',
    },
    outDir: 'dist/db',
    emptyOutDir: false,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
    minify: 'esbuild',
    target: 'es2020',
  },
});
