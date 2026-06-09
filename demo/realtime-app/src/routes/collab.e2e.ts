import { test, expect, type Page } from '@playwright/test';

async function gotoCollab(page: Page, room: string) {
	await page.goto(`/collab?room=${encodeURIComponent(room)}`);
	await expect(page.getByTestId('collab-app')).toBeVisible({ timeout: 15_000 });
	await expect(page.getByTestId('collab-editor')).toBeVisible();
}

test.describe('collab RealtimeText', () => {
	test('typing syncs across tabs in the same room', async ({ browser }) => {
		const room = `collab-e2e-${Date.now()}`;
		const context = await browser.newContext();
		const pageA = await context.newPage();
		const pageB = await context.newPage();

		await gotoCollab(pageA, room);
		await gotoCollab(pageB, room);

		const snippet = `hello-${Date.now()}`;
		await pageA.getByTestId('collab-editor').fill(snippet);

		await expect(pageB.getByTestId('collab-editor')).toHaveValue(snippet, { timeout: 10_000 });

		const appended = `${snippet}-world`;
		await pageA.getByTestId('collab-editor').fill(appended);
		await expect(pageB.getByTestId('collab-editor')).toHaveValue(appended, { timeout: 10_000 });

		await context.close();
	});

	test('different room query params stay isolated', async ({ browser }) => {
		const context = await browser.newContext();
		const pageA = await context.newPage();
		const pageB = await context.newPage();

		await gotoCollab(pageA, 'room-a');
		await gotoCollab(pageB, 'room-b');

		await pageA.getByTestId('collab-editor').fill('only-in-a');
		await pageB.getByTestId('collab-editor').fill('only-in-b');

		await expect(pageA.getByTestId('collab-editor')).toHaveValue('only-in-a');
		await expect(pageB.getByTestId('collab-editor')).toHaveValue('only-in-b');

		await context.close();
	});
});
