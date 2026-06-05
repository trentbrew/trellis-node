import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

const TRELLIS = process.env.TRELLIS_URL ?? 'http://localhost:3920';

async function createFramework(request: APIRequestContext, title: string, laneId = 'main') {
	const created = await createFrameworkId(request, title, laneId);
	expect(created).toBeTruthy();
}

async function createFrameworkId(
	request: APIRequestContext,
	title: string,
	laneId = 'main'
): Promise<string> {
	const create = await request.post(`${TRELLIS}/entities`, {
		data: { type: 'framework', attributes: { title, slug: title, laneId } }
	});
	expect(create.ok()).toBeTruthy();
	return (await create.json()).id as string;
}

async function gotoFractal(page: Page) {
	await page.goto('/fractal');
	await expect(page.getByTestId('fractal-app')).toHaveAttribute('data-hydrated', 'true', {
		timeout: 15_000
	});
}

test.describe('fractal wedge', () => {
	test('one kernel renders at multiple vantages; edit propagates live', async ({
		page,
		request
	}) => {
		const title = `fractal-${Date.now()}`;
		const edited = `${title}-edited`;
		await createFramework(request, title);

		await gotoFractal(page);
		await page.locator('select').selectOption({ label: title });

		// Spectrum (2,5,8) + focus (8) = four shells, all showing the same kernel.
		await expect(page.locator('[data-shell="node"]')).toHaveCount(1);
		await expect(page.locator('[data-shell="row"]')).toHaveCount(1);
		await expect(page.locator('[data-shell="card"]')).toHaveCount(2);
		await expect(page.locator('[data-shell="row"] .name')).toHaveText(title);

		// Edit the focus card; every other shell is a different subscriber to the
		// same (id, lane) kernel, so they must update without a reload.
		await page.locator('.edit-input').fill(edited);
		await page.locator('.edit button', { hasText: 'Save' }).click();

		await expect(page.locator('[data-shell="row"] .name')).toHaveText(edited, { timeout: 5000 });
		await expect(page.locator('[data-shell="node"] .name')).toHaveText(edited);
	});

	test('lane is the version axis — same id resolves differently per lane', async ({
		page,
		request
	}) => {
		const title = `fractal-lane-${Date.now()}`;
		await createFramework(request, title); // main only

		await gotoFractal(page);
		await page.locator('select').selectOption({ label: title });
		await expect(page.locator('[data-shell="row"] .name')).toHaveText(title);

		// Switch to a lane where this id does not exist: representation persists,
		// the kernel resolves to absent.
		await page.getByRole('button', { name: 'agent:demo', exact: true }).click();
		await expect(page.locator('.missing').first()).toContainText('not present in agent:demo', {
			timeout: 5000
		});
	});

	test('cross-term — vantage and lane stay independent under simultaneous mixed render', async ({
		page,
		request
	}) => {
		const aTitle = `ct-main-${Date.now()}`;
		const bTitle = `ct-demo-${Date.now()}`;
		const aId = await createFrameworkId(request, aTitle, 'main');
		const bId = await createFrameworkId(request, bTitle, 'agent:demo');

		await page.goto(`/fractal?ctA=${encodeURIComponent(aId)}&ctB=${encodeURIComponent(bId)}`);
		await expect(page.getByTestId('fractal-app')).toHaveAttribute('data-hydrated', 'true', {
			timeout: 15_000
		});

		const shellA = page.locator(`.thing[data-thing-id="${aId}"]`);
		const shellB = page.locator(`.thing[data-thing-id="${bId}"]`);

		// A: main @ vantage 2 (node). B: agent:demo @ vantage 13 (card). Mixed on both axes.
		await expect(shellA).toHaveAttribute('data-shell', 'node');
		await expect(shellA).toHaveAttribute('data-lane', 'main');
		await expect(shellA.locator('.name')).toHaveText(aTitle);
		await expect(shellB).toHaveAttribute('data-shell', 'card');
		await expect(shellB).toHaveAttribute('data-lane', 'agent:demo');
		await expect(shellB.locator('.name')).toHaveText(bTitle);

		// Edit B (agent:demo, vantage 13). Measure: B updates; A (main, vantage 2) is
		// untouched in value AND representation — no lane/vantage cross-leak.
		const bEdited = `${bTitle}-edited`;
		await shellB.locator('.edit-input').fill(bEdited);
		await shellB.locator('.edit button', { hasText: 'Save' }).click();

		await expect(shellB.locator('.name')).toHaveText(bEdited, { timeout: 5000 });
		await expect(shellA.locator('.name')).toHaveText(aTitle);
		await expect(shellA).toHaveAttribute('data-shell', 'node');
		await expect(shellB).toHaveAttribute('data-shell', 'card');
	});
});
