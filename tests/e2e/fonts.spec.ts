import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { comparePdfWithScreenshot } from './compare';
import { editor, openEditor, samplePdf, watchErrors } from './helpers';

// big enough to show a whole A4 page at 200% in the editor
test.use({ viewport: { width: 2100, height: 2500 } });

test('every font looks the same in the exported PDF as in the editor', async ({ page, context }) => {
  test.setTimeout(300_000);
  const noErrors = watchErrors(page);
  await openEditor(page, await samplePdf({ blankPages: 2 }));
  const ed = editor(page);
  const fontSelect = page.locator('.overlay-panel select');
  const settled = () => expect(page.locator('.overlay-panel [role=status]')).toHaveCount(0);
  const screenshots: Buffer[] = [];
  let fontCount = 0;

  // page 1: every font in regular, page 2: in bold, one line each
  for (const [pageIndex, bold] of [[0, false], [1, true]] as const) {
    if (pageIndex > 0) await page.getByRole('button', { name: 'Next page' }).click();
    const fonts = await (async () => {
      await ed.addText();
      await fontSelect.waitFor();
      const options = await fontSelect.locator('option').evaluateAll((els) => els.map((el) => [(el as HTMLOptionElement).value, el.textContent!]));
      await ed.selected.focus();
      await page.keyboard.press('Delete');
      await expect(page.locator('.editor .overlay')).toHaveCount(0);
      expect(options.length).toBeGreaterThan(20);
      return options;
    })();
    fontCount = fonts.length;
    for (const [index, [value, label]] of fonts.entries()) {
      await ed.addText();
      await page.locator('.overlay-panel textarea').fill(`Árvíztűrő tükörfúrógép ŐŰőű „x” <=> fi – ${label.split(' (')[0]}`);
      await fontSelect.selectOption(value);
      await settled();
      await page.locator('.overlay-panel input[type=checkbox]').setChecked(bold);
      await settled();
      await expect(ed.selectedText).toHaveAttribute('font-family', `PDForge ${value}`);
      await expect(ed.selectedText).toHaveAttribute('font-weight', bold ? '700' : '400');
      await page.locator('.overlay-panel input[type=number]').fill('12');
      // spread the lines out: Shift + arrow moves by 10 pt
      await ed.selected.focus();
      const steps = Math.round((index - fonts.length / 2) * 2.8);
      for (let i = 0; i < Math.abs(steps); i++) await page.keyboard.press(steps < 0 ? 'Shift+ArrowUp' : 'Shift+ArrowDown');
      for (let i = 0; i < 17; i++) await page.keyboard.press('Shift+ArrowLeft');
    }
    await page.keyboard.press('Escape');
    await ed.zoomSelect.selectOption('200');
    // the sharper page rendering arrives a moment after a zoom
    await page.waitForTimeout(1000);
    screenshots.push(await ed.surface.screenshot());
    await ed.zoomSelect.selectOption('page');
  }

  await page.getByRole('button', { name: 'Back to pages' }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download PDF' }).click()]);
  const pdf = readFileSync((await download.path())!);

  for (const [pageIndex, screenshot] of screenshots.entries()) {
    const lines = await comparePdfWithScreenshot(context, pdf, pageIndex, screenshot);
    expect(lines.length, `text lines found on page ${pageIndex + 1}`).toBe(fontCount);
    for (const [line, score] of lines.entries()) expect(score, `page ${pageIndex + 1}, line ${line + 1}`).toBeLessThan(0.01);
  }
  noErrors();
});
