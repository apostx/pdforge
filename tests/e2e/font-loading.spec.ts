import { expect, test } from '@playwright/test';
import { editor, openEditor, samplePdf, setToggle } from './helpers';

test('a font is loaded before a text switches to it; one that fails changes nothing', async ({ page }) => {
  await openEditor(page, await samplePdf());
  const ed = editor(page);
  await ed.addText();
  const fontSelect = page.locator('.overlay-panel .font-select');
  await expect(ed.selectedText).toHaveAttribute('font-family', 'PDForge openSans');

  // slow: the text keeps showing in its old font, with a note
  await page.route('**/Lora_400Regular-*.ttf', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await route.continue();
  });
  await fontSelect.selectOption('lora');
  await expect(page.locator('.overlay-panel [role=status]')).toHaveText('Loading the font…');
  await expect(ed.selectedText).toHaveAttribute('font-family', 'PDForge openSans');
  await expect(ed.selectedText).toHaveAttribute('font-family', 'PDForge lora');
  await expect(page.locator('.overlay-panel [role=status]')).toHaveCount(0);

  // failing (offline, say): an error, and the text and the menu stay as they were
  await page.route('**/Kalam_400Regular-*.ttf', (route) => route.abort());
  await fontSelect.selectOption('kalam');
  await expect(page.locator('.overlay-panel .form-error')).toContainText('could not be loaded');
  await expect(ed.selectedText).toHaveAttribute('font-family', 'PDForge lora');
  await expect(fontSelect).toHaveValue('lora');

  // trying again once it can load
  await page.unroute('**/Kalam_400Regular-*.ttf');
  await fontSelect.selectOption('kalam');
  await expect(ed.selectedText).toHaveAttribute('font-family', 'PDForge kalam');
  await expect(page.locator('.overlay-panel .form-error')).toHaveCount(0);
});

test('a new text takes the style of the last one changed', async ({ page }) => {
  await openEditor(page, await samplePdf());
  const ed = editor(page);
  await ed.addText();
  await page.locator('.overlay-panel .font-select').selectOption('tinos');
  await expect(ed.selectedText).toHaveAttribute('font-family', 'PDForge tinos');
  await setToggle(page, 'Bold');
  await expect(ed.selectedText).toHaveAttribute('font-weight', '700');
  await setToggle(page, 'Align right');
  await page.locator('.overlay-panel input[type=number]').fill('20');
  await page.keyboard.press('Escape');
  await ed.addText();
  await expect(ed.selectedText).toHaveAttribute('font-family', 'PDForge tinos');
  await expect(ed.selectedText).toHaveAttribute('font-weight', '700');
  await expect(ed.selectedText).toHaveAttribute('font-size', '20');
  await expect(page.locator('.overlay-panel').getByRole('button', { name: 'Align right' })).toHaveAttribute('aria-pressed', 'true');
});

test('italic only where the font has one', async ({ page }) => {
  await openEditor(page, await samplePdf());
  const ed = editor(page);
  await ed.addText();
  await setToggle(page, 'Italic');
  await expect(ed.selectedText).toHaveAttribute('font-style', 'italic');
  const fontSelect = page.locator('.overlay-panel .font-select');
  // Caveat has no italic: not slanted (a fake slant wouldn't match the PDF), and the button is off
  await fontSelect.selectOption('caveat');
  await expect(ed.selectedText).toHaveAttribute('font-family', 'PDForge caveat');
  await expect(ed.selectedText).toHaveAttribute('font-style', 'normal');
  await expect(page.locator('.overlay-panel').getByRole('button', { name: 'Italic' })).toBeDisabled();
  // back to a font with italics: italic again
  await fontSelect.selectOption('lora');
  await expect(ed.selectedText).toHaveAttribute('font-style', 'italic');
});
