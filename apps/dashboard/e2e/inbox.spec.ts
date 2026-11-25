import { expect, test, type Page } from '@playwright/test';

async function openInbox(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Password').fill(process.env.E2E_ADMIN_PASSWORD ?? '');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/contacts$/);
  await page.getByRole('link', { name: /^Inbox/ }).click();
  await expect(page).toHaveURL(/\/inbox$/);
}

test('resolves one decision of each type without leaving the inbox', async ({ page }) => {
  await openInbox(page);
  await expect(page.getByTestId('inbox-count')).toHaveText('3');
  await expect(page.getByTestId('inbox-total')).toHaveText('3 pending');

  // Conflict: base, hub and external are all shown.
  const conflict = page.getByTestId('conflict-card');
  await expect(conflict.getByTestId('value-base')).toHaveText('Old Co');
  await expect(conflict.getByTestId('value-hub')).toHaveText('Hub Co');
  await expect(conflict.getByTestId('value-external')).toHaveText('External Co');
  await conflict.getByRole('button', { name: 'Keep hub' }).click();
  await expect(page.getByTestId('conflict-card')).toHaveCount(0);
  await expect(page.getByTestId('inbox-count')).toHaveText('2');

  // Merge proposal.
  const merge = page.getByTestId('proposal-card').filter({ hasText: 'Merge proposal' });
  await expect(merge.getByTestId('value-external')).toContainText('mario.external@example.test');
  await merge.getByRole('button', { name: 'Merge into this contact' }).click();
  await expect(page.getByTestId('proposal-card').filter({ hasText: 'Merge proposal' })).toHaveCount(
    0,
  );
  await expect(page.getByTestId('inbox-count')).toHaveText('1');

  // Deleted-upstream proposal.
  const gone = page.getByTestId('proposal-card').filter({ hasText: 'Deleted in' });
  await gone.getByRole('button', { name: 'Keep contact' }).click();
  await expect(page.getByTestId('inbox-empty')).toBeVisible();
  await expect(page.getByTestId('inbox-count')).toHaveCount(0);
  await expect(page).toHaveURL(/\/inbox$/);
});
