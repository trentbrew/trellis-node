import { test, expect, type Page } from '@playwright/test';

async function gotoPresence(page: Page, room: string) {
	await page.goto(`/presence?room=${encodeURIComponent(room)}`);
	await expect(page.getByTestId('presence-app')).toBeVisible({ timeout: 15_000 });
	await expect(page.getByText('live', { exact: true })).toBeVisible({ timeout: 15_000 });
}

/** Move the pointer across the shared surface; a couple of moves beats the throttle. */
async function moveOnSurface(page: Page) {
	const box = await page.getByRole('application').boundingBox();
	if (!box) throw new Error('presence surface has no bounding box');
	await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.4, { steps: 3 });
	await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.55, { steps: 3 });
}

/** Cursors rendered for OTHER peers (excludes the local self-cursor). */
function remoteCursors(page: Page) {
	return page.locator('[data-testid^="cursor-"]:not([data-testid="cursor-self"])');
}

// Presence now rides BroadcastChannel (the local/free tier): cross-tab within
// one browser, no server. So the two peers are two TABS in a single context
// (a shared BroadcastChannel namespace) rather than two isolated contexts.
// Cross-device presence is the relay tier (VITE_PRESENCE_RELAY_URL) and is
// exercised separately.
test.describe('live cursors', () => {
	test('a cursor moved in one tab appears in another', async ({ browser }) => {
		const room = `e2e-presence-${Date.now()}`;
		const context = await browser.newContext();
		const pageA = await context.newPage();
		const pageB = await context.newPage();

		await gotoPresence(pageA, room);
		await gotoPresence(pageB, room);

		await moveOnSurface(pageA);

		// B has not moved, so any cursor it renders is A's remote cursor.
		await expect(remoteCursors(pageB)).toHaveCount(1, { timeout: 10_000 });
		await expect(pageB.getByTestId('cursor-self')).toHaveCount(0);

		await context.close();
	});

	test('moving renders your own self-cursor', async ({ page }) => {
		const room = `e2e-presence-self-${Date.now()}`;
		await gotoPresence(page, room);

		await expect(page.getByTestId('cursor-self')).toHaveCount(0);
		await moveOnSurface(page);
		await expect(page.getByTestId('cursor-self')).toBeVisible({ timeout: 5_000 });
	});

	test('leaving removes the cursor for others', async ({ browser }) => {
		const room = `e2e-presence-leave-${Date.now()}`;
		const context = await browser.newContext();
		const pageA = await context.newPage();
		const pageB = await context.newPage();

		await gotoPresence(pageA, room);
		await gotoPresence(pageB, room);

		await moveOnSurface(pageA);
		await expect(remoteCursors(pageB)).toHaveCount(1, { timeout: 10_000 });

		// Closing A's tab stops its heartbeat; B prunes the stale peer after the
		// presence timeout (a `bye` on unload removes it sooner when it fires).
		await pageA.close();
		await expect(remoteCursors(pageB)).toHaveCount(0, { timeout: 15_000 });

		await context.close();
	});
});
