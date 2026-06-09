import { test, expect } from '@playwright/test';

test.describe('editor redirect', () => {
	test('/editor?doc= maps to /collab?room=', async ({ page }) => {
		await page.goto('/editor?doc=my-draft');
		await expect(page).toHaveURL(/\/collab\?room=my-draft/, { timeout: 15_000 });
		await expect(page.getByTestId('collab-app')).toBeVisible();
	});

	test('/editor without params defaults room to draft', async ({ page }) => {
		await page.goto('/editor');
		await expect(page).toHaveURL(/\/collab\?room=draft/, { timeout: 15_000 });
		await expect(page.getByTestId('collab-editor')).toBeVisible();
	});

	test('/editor?room= takes precedence over doc', async ({ page }) => {
		await page.goto('/editor?doc=legacy&room=preferred');
		await expect(page).toHaveURL(/\/collab\?room=preferred/, { timeout: 15_000 });
	});
});
