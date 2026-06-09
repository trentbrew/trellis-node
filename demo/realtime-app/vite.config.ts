import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

const trellisPort = process.env.TRELLIS_PORT ?? '3920';
const trellisApi = `http://localhost:${trellisPort}`;
const trellisWs = trellisApi.replace(/^http/, 'ws');

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	ssr: {
		noExternal: ['trellis', 'bits-ui', 'carbon-icons-svelte']
	},
	server: {
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
