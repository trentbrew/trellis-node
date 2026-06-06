import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// One Vite project hosting three framework entries. Plugins are scoped by file
// extension (.tsx → React, .svelte → Svelte); Vue uses render functions, so it
// needs no plugin. They all import the same `trellis/*` adapters.
export default defineConfig({
  plugins: [react(), svelte()],
  server: { port: 4100 },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        react: resolve(__dirname, 'react/index.html'),
        vue: resolve(__dirname, 'vue/index.html'),
        svelte: resolve(__dirname, 'svelte/index.html'),
      },
    },
  },
});
