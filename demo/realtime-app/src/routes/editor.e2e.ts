import { test, expect, type Page } from '@playwright/test';

async function gotoEditor(page: Page, doc: string) {
	await page.goto(`/editor?doc=${encodeURIComponent(doc)}`);
	await expect(page.getByTestId('editor-app')).toBeVisible({ timeout: 15_000 });
	await expect(page.getByText('live', { exact: true })).toBeVisible({ timeout: 15_000 });
}

function blocks(page: Page) {
	return page.getByTestId('block-list').getByRole('textbox');
}

async function addBlock(page: Page) {
	await page.getByRole('button', { name: 'Add block' }).click();
}

/** Blur the active textarea so the edit flushes immediately (no debounce wait). */
async function blur(page: Page) {
	await page.getByRole('heading', { name: 'Block editor' }).click();
}

async function editBlock(page: Page, index: number, text: string) {
	const box = blocks(page).nth(index);
	await box.click();
	await box.fill(text);
	await blur(page);
}

test.describe('block editor', () => {
	test('a block added in one tab appears and syncs text to another', async ({ browser }) => {
		const doc = `e2e-doc-${Date.now()}`;
		const ctxA = await browser.newContext();
		const ctxB = await browser.newContext();
		const pageA = await ctxA.newPage();
		const pageB = await ctxB.newPage();

		await gotoEditor(pageA, doc);
		await gotoEditor(pageB, doc);

		await addBlock(pageA);
		await expect(blocks(pageB)).toHaveCount(1, { timeout: 10_000 });

		await editBlock(pageA, 0, 'hello from A');
		// B isn't focused on the block, so it reconciles to the server value.
		await expect(blocks(pageB).first()).toHaveValue('hello from A', { timeout: 10_000 });

		await ctxA.close();
		await ctxB.close();
	});

	test('concurrent edits to different blocks both survive (merge)', async ({ browser }) => {
		const doc = `e2e-doc-merge-${Date.now()}`;
		const ctxA = await browser.newContext();
		const ctxB = await browser.newContext();
		const pageA = await ctxA.newPage();
		const pageB = await ctxB.newPage();

		await gotoEditor(pageA, doc);
		await gotoEditor(pageB, doc);

		await addBlock(pageA);
		await addBlock(pageA);
		await expect(blocks(pageA)).toHaveCount(2, { timeout: 10_000 });
		await expect(blocks(pageB)).toHaveCount(2, { timeout: 10_000 });

		await editBlock(pageA, 0, 'from-A');
		await editBlock(pageB, 1, 'from-B');

		// Different blocks → both edits coexist everywhere.
		await expect(blocks(pageA).nth(0)).toHaveValue('from-A');
		await expect(blocks(pageA).nth(1)).toHaveValue('from-B', { timeout: 10_000 });
		await expect(blocks(pageB).nth(0)).toHaveValue('from-A', { timeout: 10_000 });
		await expect(blocks(pageB).nth(1)).toHaveValue('from-B');

		await ctxA.close();
		await ctxB.close();
	});

	test('same block is last-writer-wins', async ({ browser }) => {
		const doc = `e2e-doc-lww-${Date.now()}`;
		const ctxA = await browser.newContext();
		const ctxB = await browser.newContext();
		const pageA = await ctxA.newPage();
		const pageB = await ctxB.newPage();

		await gotoEditor(pageA, doc);
		await gotoEditor(pageB, doc);

		await addBlock(pageA);
		await expect(blocks(pageB)).toHaveCount(1, { timeout: 10_000 });

		await editBlock(pageA, 0, 'first writer');
		await expect(blocks(pageB).first()).toHaveValue('first writer', { timeout: 10_000 });

		await editBlock(pageB, 0, 'second writer');
		// The later write wins on both sides.
		await expect(blocks(pageA).first()).toHaveValue('second writer', { timeout: 10_000 });
		await expect(blocks(pageB).first()).toHaveValue('second writer');

		await ctxA.close();
		await ctxB.close();
	});
});
