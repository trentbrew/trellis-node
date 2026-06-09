import { test, expect, type Page } from '@playwright/test';

async function gotoHome(page: Page) {
	await page.goto('/');
	await expect(page.getByTestId('collections-home')).toBeVisible({ timeout: 15_000 });
}

async function openCollection(page: Page, slug: string) {
	await gotoHome(page);
	await page.locator(`[data-testid="collection-card"][data-slug="${slug}"]`).click();
	await expect(page.getByTestId('collection-records')).toBeVisible({ timeout: 10_000 });
}

test.describe('Collections live platform', () => {
	test('home lists seeded collections', async ({ page }) => {
		await gotoHome(page);
		await expect(page.getByTestId('collection-grid')).toBeVisible();
		await expect(page.getByTestId('collection-card').first()).toBeVisible();
	});

	test('drill-in CRUD syncs across tabs', async ({ browser }) => {
		const context = await browser.newContext();
		const pageA = await context.newPage();
		const pageB = await context.newPage();

		const title = `e2e-record-${Date.now()}`;
		await openCollection(pageA, 'ideas');
		await openCollection(pageB, 'ideas');

		await pageA.getByTestId('new-record-input').fill(title);
		await pageA.getByRole('button', { name: 'Add' }).click();

		await expect(pageB.getByTestId('record-row').filter({ hasText: title })).toBeVisible({
			timeout: 10_000
		});

		const edited = `${title}-edited`;
		const rowA = pageA.getByTestId('record-row').filter({ hasText: title });
		await rowA.locator('input').fill(edited);
		await rowA.locator('input').blur();

		await expect(pageB.getByTestId('record-row').filter({ hasText: edited })).toBeVisible({
			timeout: 10_000
		});

		await context.close();
	});
});
