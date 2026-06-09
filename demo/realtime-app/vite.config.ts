import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

const appRoot = path.dirname(fileURLToPath(import.meta.url));
/** pnpm hoists deps + `trellis: file:../..` — Vite must allow @fs reads outside demo/realtime-app. */
const repoRoot = path.resolve(appRoot, '../..');

const trellisPort = process.env.TRELLIS_PORT ?? '3920';
const trellisApi = `http://localhost:${trellisPort}`;
const trellisWs = trellisApi.replace(/^http/, 'ws');

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	ssr: {
		noExternal: ['trellis', 'bits-ui', 'carbon-icons-svelte']
	},
	server: {
		fs: {
			allow: [appRoot, repoRoot]
		},
		headers: {
			'Cross-Origin-Opener-Policy': 'same-origin',
			'Cross-Origin-Embedder-Policy': 'credentialless'
		},
		// Graph nav + typed SDK talk to the sidecar through same-origin paths.
		proxy: {
			'/entities': trellisApi,
			'/query': trellisApi,
			'/ontologies': trellisApi,
			'/realtime': { target: trellisWs, ws: true }
		}
	}
});
