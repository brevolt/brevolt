import { randomBytes } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page, password: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/contacts$/);
}

async function changePassword(page: Page, current: string, next: string): Promise<void> {
  await page.goto('/settings');
  await page.getByLabel('Current password').fill(current);
  await page.getByLabel('New password', { exact: true }).fill(next);
  await page.getByLabel('Repeat new password').fill(next);
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByText('Password changed')).toBeVisible();
}

test('changes the password, signs out and signs in with the new one', async ({ page }) => {
  const original = process.env.E2E_ADMIN_PASSWORD ?? '';
  const next = randomBytes(18).toString('base64url');
  await signIn(page, original);
  try {
    await changePassword(page, original, next);
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await signIn(page, next);
  } finally {
    // Restore the shared password so the other specs keep working.
    await page.goto('/settings');
    if (await page.getByLabel('Current password').isVisible()) {
      await changePassword(page, next, original);
    }
  }
});

test('shows a clear error for a wrong current password', async ({ page }) => {
  await signIn(page, process.env.E2E_ADMIN_PASSWORD ?? '');
  await page.goto('/settings');
  await page.getByLabel('Current password').fill('definitely not the password');
  await page.getByLabel('New password', { exact: true }).fill('a brand new password 1');
  await page.getByLabel('Repeat new password').fill('a brand new password 1');
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByRole('alert')).toHaveText('The current password is incorrect.');
});
