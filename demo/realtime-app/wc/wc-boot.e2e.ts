import { test, expect } from '@playwright/test';

const WC_E2E = process.env.WC_E2E === '1';

test.describe('WebContainer full boot', () => {
	test.skip(!WC_E2E, 'Set WC_E2E=1 to run full WebContainer boot (slow)');

	test.describe.configure({ timeout: 360_000 });

	test.use({ baseURL: 'http://localhost:4500' });

	test('boots trellis + vite inside WebContainer', async ({ page }) => {
		await page.goto('/');

		await expect(page.locator('#log')).toContainText('Booting WebContainer', { timeout: 30_000 });
		await expect(page.locator('#links a')).toBeVisible({ timeout: 300_000 });

		const appUrl = await page.locator('#links a').getAttribute('href');
		expect(appUrl).toBeTruthy();

		const appPage = await page.context().newPage();
		await appPage.goto(appUrl!, { waitUntil: 'domcontentloaded', timeout: 120_000 });

		await expect(appPage.getByRole('heading', { name: 'Collections' })).toBeVisible({
			timeout: 120_000
		});
		await expect(appPage.getByTestId('platform-status')).toContainText('Trellis', {
			timeout: 120_000
		});
	});
});
