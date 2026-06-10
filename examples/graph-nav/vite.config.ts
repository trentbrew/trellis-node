import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import vue from '@vitejs/plugin-vue';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// Trellis entity server (server.mjs). Vite proxies API + WS to one origin.
const trellisPort = process.env.TRELLIS_PORT ?? '8230';
const API = process.env.VITE_TRELLIS_API ?? `http://localhost:${trellisPort}`;
const WS = API.replace(/^http/, 'ws');

export default defineConfig({
  plugins: [react(), vue(), svelte()],
  server: {
    port: Number(process.env.PORT ?? 4200),
    proxy: {
      '/entities': API,
      '/query': API,
      '/ontologies': API,
      '/realtime': { target: WS, ws: true },
      '/__trellis': API,
    },
  },
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
