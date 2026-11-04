import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { PDFDocument, rgb } from 'pdf-lib';
import { comparePdfWithScreenshot, renderPdfPage } from './compare';
import { photoJpg, stampPng } from './fixtures';
import { editor, samplePdf, watchErrors } from './helpers';

test.use({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });

async function addFiles(page: Page, files: { name: string; mimeType: string; buffer: Buffer }[]) {
  await page.goto('/');
  await page.locator('input[type=file][accept*="pdf"]').first().setInputFiles(files);
  await expect(page.locator('.page-card')).not.toHaveCount(0);
}

async function editPage(page: Page, index: number) {
  const card = page.locator('.page-card').nth(index);
  await card.hover();
  await card.getByRole('button', { name: /^Edit page/ }).click();
  await expect(page.locator('.editor .page-surface')).toBeVisible();
}

async function download(page: Page, editable: boolean): Promise<Buffer> {
  await page.getByRole('checkbox', { name: 'Editable in PDForge' }).setChecked(editable);
  const [file] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download PDF' }).click()]);
  return readFileSync((await file.path())!);
}

/** Placed items per page, as the page list shows them. */
const overlayCounts = (page: Page) =>
  page.locator('.page-card').evaluateAll((cards) => cards.map((card) => card.querySelectorAll('.overlay').length));

test('an editable PDF opens again with its items editable, and looks like a plain one', async ({ page, browser }) => {
  const noErrors = watchErrors(page);
  await addFiles(page, [
    { name: 'sample.pdf', mimeType: 'application/pdf', buffer: await samplePdf() },
    { name: 'photo.jpg', mimeType: 'image/jpeg', buffer: photoJpg },
  ]);
  await expect(page.locator('.page-card')).toHaveCount(4);
  const ed = editor(page);

  // page 1: a bold Tinos text, a cover box and a stamp; page 3 (turned) and the photo page: a text each
  await editPage(page, 0);
  await ed.addText();
  await page.locator('.overlay-panel textarea').fill('Árvíztűrő\nmásodik sor');
  await page.locator('.overlay-panel select').selectOption('tinos');
  await expect(ed.selectedText).toHaveAttribute('font-family', 'PDForge tinos');
  await page.locator('.overlay-panel input[type=checkbox]').check();
  await expect(ed.selectedText).toHaveAttribute('font-weight', '700');
  await page.locator('.editor__tools').getByRole('button', { name: 'Cover box' }).click();
  for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+ArrowDown');
  await page.locator('.editor__tools input[type=file]').setInputFiles({ name: 'stamp.png', mimeType: 'image/png', buffer: stampPng });
  await expect(page.locator('.editor .overlay--selected img')).toBeVisible();
  for (let i = 0; i < 10; i++) await page.keyboard.press('Shift+ArrowUp');
  for (const text of ['on the turned page', 'on the photo']) {
    await page.getByRole('button', { name: 'Next page' }).click();
    if (text === 'on the turned page') await page.getByRole('button', { name: 'Next page' }).click();
    await ed.addText();
    await page.locator('.overlay-panel textarea').fill(text);
  }
  await page.getByRole('button', { name: 'Back to pages' }).click();
  // page 2 turned in PDForge
  await page.locator('.page-card').nth(1).locator('input[type=checkbox]').check();
  await page.getByRole('button', { name: 'Rotate right', exact: true }).click();
  const counts = await overlayCounts(page);
  expect(counts).toEqual([3, 0, 1, 1]);

  const editablePdf = await download(page, true);
  const plainPdf = await download(page, false);
  expect(editablePdf.length).toBeLessThan(plainPdf.length + 20_000);

  // the same pages in any viewer
  const context = page.context();
  for (let index = 0; index < 4; index++) {
    const lines = await comparePdfWithScreenshot(context, editablePdf, index, await renderPdfPage(context, plainPdf, index, 600));
    for (const score of lines) expect(score).toBeLessThan(0.001);
  }

  // opened again elsewhere: the same items, editable
  const other = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  const reopened = await other.newPage();
  await addFiles(reopened, [{ name: 'edited.pdf', mimeType: 'application/pdf', buffer: editablePdf }]);
  await expect(reopened.locator('.page-card')).toHaveCount(4);
  await expect.poll(() => overlayCounts(reopened)).toEqual(counts);
  await expect(reopened.locator('.notice')).toHaveCount(0);
  await editPage(reopened, 0);
  const text = reopened.locator('.editor .overlay svg text');
  await expect(text).toHaveAttribute('font-family', 'PDForge tinos');
  await expect(text).toHaveAttribute('font-weight', '700');
  await expect(text).toHaveText('Árvíztűrőmásodik sor');
  await reopened.locator('.editor .overlay').first().click({ position: { x: 3, y: 3 } });
  await reopened.locator('.overlay-panel textarea').fill('Árvíztűrő\nmásodik sor (javítva)');
  await reopened.getByRole('button', { name: 'Back to pages' }).click();

  // exported again (still editable) and opened a third time: nothing doubled, nothing lost
  const again = await download(reopened, true);
  for (let index = 1; index < 4; index++) {
    const lines = await comparePdfWithScreenshot(context, again, index, await renderPdfPage(context, plainPdf, index, 600));
    for (const score of lines) expect(score).toBeLessThan(0.001);
  }
  const third = await other.newPage();
  await addFiles(third, [{ name: 'again.pdf', mimeType: 'application/pdf', buffer: again }]);
  await expect.poll(() => overlayCounts(third)).toEqual(counts);
  await other.close();
  noErrors();
});

test('a PDF changed by another program after export opens as a plain PDF', async ({ page }) => {
  await addFiles(page, [{ name: 'sample.pdf', mimeType: 'application/pdf', buffer: await samplePdf() }]);
  await editPage(page, 0);
  await editor(page).addText();
  await page.getByRole('button', { name: 'Back to pages' }).click();
  const editablePdf = await download(page, true);

  const changed = await PDFDocument.load(editablePdf);
  changed.getPage(0).drawRectangle({ x: 10, y: 10, width: 20, height: 20, color: rgb(1, 0, 0) });
  const fresh = await page.context().newPage();
  await addFiles(fresh, [{ name: 'changed.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await changed.save()) }]);
  await expect(fresh.locator('.notice')).toContainText('changed by another program');
  expect(await overlayCounts(fresh)).toEqual([0, 0, 0]);
});
