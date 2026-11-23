import { expect, test } from '@playwright/test';

test('reviews the dry-run diff and enables sync after confirming', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Password').fill(process.env.E2E_ADMIN_PASSWORD ?? '');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/contacts$/);

  await page.getByRole('link', { name: 'Sync' }).click();
  await expect(page.getByRole('heading', { name: 'Dry-run is on' })).toBeVisible();
  await expect(
    page.getByRole('list', { name: 'Sync diff' }).getByRole('listitem').first(),
  ).toContainText('Would create');

  await page.getByRole('button', { name: 'Enable sync' }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await page.getByRole('button', { name: 'Yes, enable sync' }).click();
  await expect(page.getByRole('heading', { name: 'Sync is on' })).toBeVisible();

  // Leave the shared database as found for the other specs.
  await page.getByRole('button', { name: 'Turn dry-run back on' }).click();
  await expect(page.getByRole('heading', { name: 'Dry-run is on' })).toBeVisible();
});
