import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// One Vite project hosting nine framework entries (3 demos × 3 frameworks).
export default defineConfig({
  plugins: [react(), svelte()],
  server: { port: Number(process.env.PORT ?? 4100) },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        'presence-react': resolve(__dirname, 'react/index.html'),
        'presence-vue': resolve(__dirname, 'vue/index.html'),
        'presence-svelte': resolve(__dirname, 'svelte/index.html'),
        'chat-react': resolve(__dirname, 'chat/react/index.html'),
        'chat-vue': resolve(__dirname, 'chat/vue/index.html'),
        'chat-svelte': resolve(__dirname, 'chat/svelte/index.html'),
        'text-react': resolve(__dirname, 'text/react/index.html'),
        'text-vue': resolve(__dirname, 'text/vue/index.html'),
        'text-svelte': resolve(__dirname, 'text/svelte/index.html'),
      },
    },
  },
});
