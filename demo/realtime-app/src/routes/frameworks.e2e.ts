import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

const TRELLIS = process.env.TRELLIS_URL ?? 'http://localhost:3920';

async function createFramework(request: APIRequestContext, title: string, laneId = 'main') {
	const create = await request.post(`${TRELLIS}/entities`, {
		data: {
			type: 'framework',
			attributes: { title, slug: title, laneId }
		}
	});
	expect(create.ok()).toBeTruthy();
}

async function createTag(request: APIRequestContext, name: string) {
	const create = await request.post(`${TRELLIS}/entities`, {
		data: { type: 'tag', attributes: { name } }
	});
	expect(create.ok()).toBeTruthy();
}

function frameworkRow(page: Page, title: string) {
	return page
		.locator('li')
		.filter({ has: frameworkInput(page, title) })
		.first();
}

function frameworkInput(page: Page, title: string) {
	return page.locator(`input[value="${title}"]`).first();
}

async function gotoFrameworks(page: Page, lane?: string) {
	await page.goto(lane ? `/?lane=${encodeURIComponent(lane)}` : '/');
	await expect(page.getByTestId('frameworks-app')).toHaveAttribute('data-hydrated', 'true', {
		timeout: 15_000
	});
}

async function confirmDialog(page: Page, actionLabel: string) {
	await page.getByRole('button', { name: actionLabel }).first().click();
	await page.getByTestId('confirm-dialog-submit').click();
}

async function addDraftFramework(page: Page, lane: string, title: string) {
	await gotoFrameworks(page, lane);
	await page.getByPlaceholder('Add a framework…').fill(title);
	await page
		.locator('form')
		.filter({ has: page.getByPlaceholder('Add a framework…') })
		.getByRole('button', { name: 'Add' })
		.click();
	await expect(frameworkInput(page, title)).toBeVisible({ timeout: 15_000 });
}

test.describe('frameworks live platform', () => {
	test('edit persists in the input after save', async ({ page, request }) => {
		const title = `edit-${Date.now()}`;
		const updated = `${title}-saved`;
		await createFramework(request, title);

		await gotoFrameworks(page);

		const row = frameworkRow(page, title);
		const input = row.getByRole('textbox').first();
		await input.fill(updated);
		await row.getByRole('button', { name: 'Save' }).click();
		await expect(frameworkInput(page, updated)).toBeVisible({ timeout: 5000 });
	});

	test('external API mutation appears without refresh', async ({ page, request }) => {
		const title = `live-sync-${Date.now()}`;

		await gotoFrameworks(page);

		await createFramework(request, title);

		await expect(frameworkInput(page, title)).toBeVisible({ timeout: 5000 });
	});

	test('tag toggle assigns graph link', async ({ page, request }) => {
		const title = `tag-toggle-${Date.now()}`;
		const tagName = `tag-${Date.now()}`;
		await createFramework(request, title);
		await createTag(request, tagName);

		await gotoFrameworks(page);

		const row = frameworkRow(page, title);
		const tagButton = row.getByRole('button', { name: tagName, pressed: false });
		await expect(tagButton).toBeVisible({ timeout: 5000 });
		await tagButton.click();
		await expect(row.getByRole('button', { name: tagName, pressed: true })).toBeVisible();
		await expect(row.getByTestId(/framework-tag-count-/)).toHaveText(/1 tag · kernel rollup/);
	});

	test('lane promote merges tagged links into main', async ({ page, request }) => {
		const lane = `agent:e2e-tags-${Date.now()}`;
		const title = `tagged-promote-${Date.now()}`;
		const tagName = `promo-${Date.now()}`;

		await createTag(request, tagName);

		await addDraftFramework(page, lane, title);

		await frameworkRow(page, title).getByRole('button', { name: tagName }).click();

		await confirmDialog(page, 'Promote');
		await gotoFrameworks(page);

		const mainRow = frameworkRow(page, title);
		await expect(mainRow).toBeVisible({ timeout: 5000 });
		await expect(mainRow.getByRole('button', { name: tagName, pressed: true })).toBeVisible();
	});

	test('draft lane promote merges into main', async ({ page }) => {
		const lane = `agent:e2e-${Date.now()}`;
		const title = `lane-promote-${Date.now()}`;

		await addDraftFramework(page, lane, title);

		await confirmDialog(page, 'Promote');
		await gotoFrameworks(page);
		await expect(frameworkInput(page, title)).toBeVisible({ timeout: 5000 });
	});
});

test.describe('platform status', () => {
	test('reports trellis connectivity', async ({ page }) => {
		await gotoFrameworks(page);
		await expect(page.getByTestId('platform-status')).toContainText('Trellis connected', {
			timeout: 10_000
		});
	});
});
