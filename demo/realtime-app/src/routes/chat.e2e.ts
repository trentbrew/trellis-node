import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

const TRELLIS = process.env.TRELLIS_URL ?? 'http://localhost:3920';

async function gotoChat(page: Page, room: string) {
	await page.goto(`/chat?room=${encodeURIComponent(room)}`);
	await expect(page.getByTestId('chat-app')).toBeVisible({ timeout: 15_000 });
	// LiveIndicator renders the exact text "live" once the stream connects.
	await expect(page.getByText('live', { exact: true })).toBeVisible({ timeout: 15_000 });
}

async function send(page: Page, text: string) {
	const input = page.getByPlaceholder(/^Message /);
	await input.fill(text);
	await page.getByRole('button', { name: 'Send' }).click();
	await expect(input).toHaveValue('');
}

async function createMessage(request: APIRequestContext, room: string, text: string) {
	const res = await request.post(`${TRELLIS}/entities`, {
		data: {
			type: 'message',
			attributes: { room, author: 'API', color: '#0f62fe', text, createdAt: Date.now() }
		}
	});
	expect(res.ok()).toBeTruthy();
}

test.describe('chat room', () => {
	test('message posted in one tab appears in another', async ({ browser }) => {
		const room = `e2e-chat-${Date.now()}`;
		const ctxA = await browser.newContext();
		const ctxB = await browser.newContext();
		const pageA = await ctxA.newPage();
		const pageB = await ctxB.newPage();

		await gotoChat(pageA, room);
		await gotoChat(pageB, room);

		const text = `hello-${Date.now()}`;
		await send(pageA, text);

		await expect(pageB.getByTestId('chat-log')).toContainText(text, { timeout: 10_000 });
		await expect(pageA.getByTestId('chat-log')).toContainText(text);

		await ctxA.close();
		await ctxB.close();
	});

	test('messages render in send order', async ({ browser }) => {
		const room = `e2e-chat-order-${Date.now()}`;
		const ctx = await browser.newContext();
		const page = await ctx.newPage();
		await gotoChat(page, room);

		const stamp = Date.now();
		const msgs = [`a-${stamp}`, `b-${stamp}`, `c-${stamp}`];
		for (const m of msgs) await send(page, m);

		const rendered = page.getByTestId('chat-message');
		await expect(rendered).toHaveCount(3, { timeout: 10_000 });
		await expect(rendered.nth(0)).toContainText(msgs[0]);
		await expect(rendered.nth(1)).toContainText(msgs[1]);
		await expect(rendered.nth(2)).toContainText(msgs[2]);

		await ctx.close();
	});

	test('external API message appears without refresh', async ({ page, request }) => {
		const room = `e2e-chat-api-${Date.now()}`;
		await gotoChat(page, room);

		const text = `api-${Date.now()}`;
		await createMessage(request, room, text);

		await expect(page.getByTestId('chat-log')).toContainText(text, { timeout: 10_000 });
	});
});
