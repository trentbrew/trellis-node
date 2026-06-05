import { defineConfig } from '@playwright/test';

export default defineConfig({
	webServer: [
		{
			command: 'pnpm dev:all',
			port: 4000,
			reuseExistingServer: !process.env.CI,
			timeout: 120_000
		},
		{
			command: 'pnpm wc:host',
			port: 4500,
			reuseExistingServer: !process.env.CI,
			timeout: 30_000
		}
	],
	// These E2E specs drive one shared Trellis sidecar + dev server. Running them
	// across multiple workers races on shared backend state and triggers a thundering
	// herd of on-demand Vite client compilation that stalls hydration. Run serially.
	workers: 1,
	testMatch: '**/*.{e2e,spec}.{ts,js}',
	use: { baseURL: 'http://localhost:4000' }
});
