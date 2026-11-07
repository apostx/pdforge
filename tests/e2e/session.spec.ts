import { expect, test, type Page } from '@playwright/test';
import { photoJpg, stampPng } from './fixtures';
import { editor, samplePdf, watchErrors } from './helpers';

test.use({ viewport: { width: 1280, height: 800 } });

const summary = (page: Page) =>
  page.locator('.page-card').evaluateAll((cards) =>
    cards.map((card) => `${card.querySelector('.page-card__caption')?.textContent}: ${card.querySelectorAll('.overlay').length}`),
  );

test('files and changes survive a reload, until turned off', async ({ page, context }) => {
  const noErrors = watchErrors(page);
  await page.goto('/');
  await page.locator('input[type=file][accept*="pdf"]').first().setInputFiles([
    { name: 'sample.pdf', mimeType: 'application/pdf', buffer: await samplePdf() },
    { name: 'photo.jpg', mimeType: 'image/jpeg', buffer: photoJpg },
  ]);
  await expect(page.locator('.page-card')).toHaveCount(4);

  const card = page.locator('.page-card').nth(3);
  await card.hover();
  await card.getByRole('button', { name: /^Edit page/ }).click();
  const ed = editor(page);
  await ed.addText();
  await page.locator('.overlay-panel textarea').fill('kept text');
  await page.locator('.overlay-panel .font-select').selectOption('lora');
  await expect(ed.selectedText).toHaveAttribute('font-family', 'PDForge lora');
  await page.locator('.editor__tools input[type=file]').setInputFiles({ name: 'stamp.png', mimeType: 'image/png', buffer: stampPng });
  await expect(page.locator('.editor .overlay--selected img')).toBeVisible();
  await page.getByRole('button', { name: 'Back to pages' }).click();
  await page.locator('.page-card').nth(1).locator('input[type=checkbox]').check();
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await page.getByLabel('Image quality').selectOption('medium');
  // changes are saved within half a second
  await page.waitForTimeout(1000);
  await expect(page.locator('.keep-work')).toContainText('Kept in this browser');
  const before = await summary(page);
  expect(before).toEqual(['sample.pdf · 1: 0', 'sample.pdf · 3: 0', 'photo.jpg: 2']);

  await page.reload();
  await expect.poll(() => summary(page)).toEqual(before);
  await expect(page.getByLabel('Image quality')).toHaveValue('medium');
  const restored = page.locator('.page-card').nth(2);
  await restored.hover();
  await restored.getByRole('button', { name: /^Edit page/ }).click();
  await expect(page.locator('.editor .overlay svg text')).toHaveText('kept text');
  await expect(page.locator('.editor .overlay svg text')).toHaveAttribute('font-family', 'PDForge lora');
  await expect(page.locator('.editor .overlay img')).toHaveCount(1);
  await page.getByRole('button', { name: 'Back to pages' }).click();

  // another tab works without keeping, and doesn't overwrite this one
  const second = await context.newPage();
  await second.goto('/');
  await second.locator('input[type=file][accept*="pdf"]').first().setInputFiles({ name: 'other.pdf', mimeType: 'application/pdf', buffer: await samplePdf() });
  await expect(second.locator('.keep-work')).toContainText('open in another tab');
  await second.close();
  await page.reload();
  await expect.poll(() => summary(page)).toEqual(before);

  // turned off: what was kept is deleted
  await page.getByRole('checkbox', { name: 'Keep after reload' }).uncheck();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise<number>((resolve) => {
            const request = indexedDB.open('pdforge-session');
            request.onsuccess = () => {
              const count = request.result.transaction('files').objectStore('files').count();
              count.onsuccess = () => resolve(count.result);
            };
          }),
      ),
    )
    .toBe(0);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Add files' })).toBeVisible();
  await expect(page.locator('.page-card')).toHaveCount(0);
  noErrors();
});
