import { expect, test, type Page } from '@playwright/test';
import { SEED_COUNT } from './global-setup.js';

async function login(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('Password').fill(process.env.E2E_ADMIN_PASSWORD ?? '');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Brevolt' })).toBeVisible();
}

const count = (page: Page) => page.getByTestId('contact-count');

test.beforeEach(async ({ page }) => {
  await login(page);
});

test('the list stays light with 5,000 contacts and scrolls to the end', async ({ page }) => {
  await expect(count(page)).toHaveText(`${String(SEED_COUNT)} contacts`);
  // Windowed: only a few dozen rows exist in the DOM.
  expect(await page.locator('[data-testid="contact-list"] li').count()).toBeLessThan(60);

  await page.getByTestId('contact-list').evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect(
    page.getByText(`Seed${String(SEED_COUNT - 1)}`, { exact: false }).first(),
  ).toBeVisible({
    timeout: 5000,
  });
});

test('search narrows the list', async ({ page }) => {
  await page.getByLabel('Search contacts').fill('Seed0042');
  await expect(count(page)).toHaveText('1 contacts');
  await page.getByRole('button', { name: /Seed0042/ }).click();
  await expect(page.getByTestId('contact-name')).toContainText('Seed0042');
  await page.getByLabel('Search contacts').fill('nobody-matches-this');
  await expect(count(page)).toHaveText('0 contacts');
});

test('create, edit, undo and delete a contact', async ({ page }) => {
  // Create
  await page.getByRole('button', { name: 'New contact' }).click();
  await page.getByLabel('Given name').fill('Zelda');
  await page.getByLabel('Family names').fill('Zz Created');
  await page.getByRole('button', { name: 'Add field' }).click();
  await page.getByLabel('Value', { exact: true }).fill('+34 600 111 222');
  await page.getByLabel('Tags (comma separated)').fill('friends, e2e');
  await page.getByLabel('Note (Markdown)').fill('# Hello\n\nA note');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByTestId('contact-name')).toHaveText('Zelda Zz Created');
  await expect(page.getByText('e2e, friends')).toBeVisible();

  // Edit
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByLabel('Company').fill('Edited Inc');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Edited Inc')).toBeVisible();
  await expect(page.getByText(/version 2/)).toBeVisible();

  // Undo the edit from the toast
  await page.getByTestId('toast').getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText('Edited Inc')).toHaveCount(0);
  await expect(page.getByText(/version 3/)).toBeVisible();

  // History lists the operations
  await expect(page.getByTestId('history').locator('li')).toHaveCount(3);

  // Delete, then bring it back with undo
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('Contact deleted.')).toBeVisible();
  await page.getByLabel('Search contacts').fill('Zz Created');
  await expect(count(page)).toHaveText('0 contacts');
  await page.getByTestId('toast').getByRole('button', { name: 'Undo' }).click();
  await expect(count(page)).toHaveText('1 contacts');

  // Final delete leaves it gone
  await page.getByRole('button', { name: /Zz Created/ }).click();
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(count(page)).toHaveText('0 contacts');
});

test('editing warns when someone changed the contact meanwhile', async ({ page }) => {
  await page.getByLabel('Search contacts').fill('Seed0100');
  await page.getByRole('button', { name: /Seed0100/ }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByLabel('Job title').fill('Mine');

  // Another writer changes the contact through the API with the same session.
  const id = /\/contacts\/([\w-]+)/.exec(page.url())?.[1];
  const csrf = await page.locator('meta[name="csrf-token"]').getAttribute('content');
  const other = await page.request.patch(`/v1/contacts/${id ?? ''}`, {
    data: { company: 'Changed elsewhere' },
    headers: { 'if-match': '1', 'x-csrf-token': csrf ?? '' },
  });
  expect(other.status()).toBe(200);

  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('conflict-warning')).toBeVisible();

  await page.getByRole('button', { name: 'Load latest and discard my changes' }).click();
  await expect(page.getByText('Changed elsewhere').first()).toBeVisible();
  await expect(page.getByText('Mine')).toHaveCount(0);
});

test('export downloads vCard and JSON', async ({ page }) => {
  const vcf = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Export vCard' }).click();
  expect((await vcf).suggestedFilename()).toBe('brevolt-contacts.vcf');

  const json = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Export JSON' }).click();
  expect((await json).suggestedFilename()).toBe('brevolt-contacts.json');
});

test('signing out returns to the login', async ({ page }) => {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
});
