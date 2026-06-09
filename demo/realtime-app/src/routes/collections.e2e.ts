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

	test('seeded records show body text', async ({ page }) => {
		await openCollection(page, 'ideas');
		await expect(
			page.locator('[data-record-title="Fractal shell contract"][data-record-body*="representation"]')
		).toBeVisible();
	});

	test('create collection metadata syncs across tabs', async ({ browser }) => {
		const context = await browser.newContext();
		const pageA = await context.newPage();
		const pageB = await context.newPage();

		const title = `e2e-collection-${Date.now()}`;
		await gotoHome(pageA);
		await gotoHome(pageB);

		await pageA.getByTestId('new-collection-input').fill(title);
		await pageA.getByRole('button', { name: 'Add' }).click();

		await expect(pageB.getByTestId('collection-card').filter({ hasText: title })).toBeVisible({
			timeout: 10_000
		});

		await context.close();
	});

	test('drill-in CRUD syncs across tabs', async ({ browser }) => {
		const context = await browser.newContext();
		const pageA = await context.newPage();
		const pageB = await context.newPage();

		const title = `e2e-record-${Date.now()}`;
		const body = `Body for ${title}`;
		await openCollection(pageA, 'ideas');
		await openCollection(pageB, 'ideas');

		await pageA.getByTestId('new-record-input').fill(title);
		await pageA.getByTestId('new-record-body').fill(body);
		await pageA.getByRole('button', { name: 'Add' }).click();

		await expect(pageB.locator(`[data-testid="record-row"][data-record-title="${title}"]`)).toBeVisible({
			timeout: 10_000
		});
		await expect(pageB.locator(`[data-record-body="${body}"]`)).toBeVisible({ timeout: 10_000 });

		const edited = `${title}-edited`;
		const rowA = pageA.locator(`[data-testid="record-row"][data-record-title="${title}"]`);
		await rowA.locator('input').fill(edited);
		await rowA.locator('input').press('Tab');

		await expect(
			pageB.locator(`[data-testid="record-row"][data-record-title="${edited}"]`)
		).toBeVisible({ timeout: 10_000 });

		const metaTitle = `ideas-renamed-${Date.now()}`;
		await pageA.getByTestId('collection-meta-title').fill(metaTitle);
		await pageA.getByTestId('collection-meta-title').press('Tab');

		await expect(pageB.getByTestId('collection-meta-title')).toHaveValue(metaTitle, {
			timeout: 10_000
		});

		await context.close();
	});
});
