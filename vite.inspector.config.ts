import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  // Hoist SFC <style> into the custom element shadow root (defineCustomElement).
  plugins: [vue({ customElement: true })],
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
  },
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
