import { test, expect } from '@playwright/test';

test.describe('WebContainer host bootstrap', () => {
	test.use({ baseURL: 'http://localhost:4500' });

	test('serves trellis bootstrap and app pack', async ({ request }) => {
		const trellis = await request.get('/api/trellis-bootstrap');
		expect(trellis.ok()).toBeTruthy();
		const trellisBody = await trellis.json();
		expect(trellisBody.vendorPackageJson?.name).toBe('trellis');
		expect(trellisBody.binTrellis).toContain('dist/cli/index.js');
		// Root-level esbuild chunks must be packed (writeTree creates basePath on first file).
		expect(Object.keys(trellisBody.dist).some((k) => /^better-sqlite-backend-/.test(k))).toBe(
			true
		);

		const app = await request.get('/api/app-pack');
		expect(app.ok()).toBeTruthy();
		const appBody = await app.json();
		expect(appBody.files['package.json']).toBeTruthy();
		expect(appBody.files['scripts/trellis-serve.mjs']).toBeTruthy();
		expect(appBody.files['scripts/wc-start.mjs']).toBeTruthy();
	});
});
