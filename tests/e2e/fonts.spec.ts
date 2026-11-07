import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { comparePdfWithScreenshot } from './compare';
import { editor, openEditor, samplePdf, setToggle, watchErrors } from './helpers';

// big enough to show a whole A4 page at 200% in the editor
test.use({ viewport: { width: 2100, height: 2500 } });

test('every font looks the same in the exported PDF as in the editor', async ({ page, context }) => {
  test.setTimeout(300_000);
  const noErrors = watchErrors(page);
  await openEditor(page, await samplePdf({ blankPages: 4 }));
  const ed = editor(page);
  const fontSelect = page.locator('.overlay-panel .font-select');
  const settled = () => expect(page.locator('.overlay-panel [role=status]')).toHaveCount(0);
  const screenshots: Buffer[] = [];

  // one line per font: page 1 regular, 2 bold, 3 italic, 4 bold italic (fonts with italics only)
  const variants = [[false, false], [true, false], [false, true], [true, true]] as const;
  const lineCounts: number[] = [];
  for (const [pageIndex, [bold, italic]] of variants.entries()) {
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
    // fonts without italics are left off the italic pages
    const shownFonts = [];
    for (const [value, label] of fonts) {
      if (italic) {
        await ed.addText();
        await fontSelect.selectOption(value);
        await settled();
        const available = await page.locator('.overlay-panel').getByRole('button', { name: 'Italic' }).isEnabled();
        await ed.selected.focus();
        await page.keyboard.press('Delete');
        if (!available) continue;
      }
      shownFonts.push([value, label] as const);
    }
    lineCounts.push(shownFonts.length);
    for (const [index, [value, label]] of shownFonts.entries()) {
      await ed.addText();
      await page.locator('.overlay-panel textarea').fill(`Árvíztűrő tükörfúrógép ŐŰőű „x” <=> fi – ${label.split(' (')[0]}`);
      await fontSelect.selectOption(value);
      await settled();
      await setToggle(page, 'Bold', bold);
      await settled();
      await setToggle(page, 'Italic', italic);
      await settled();
      await expect(ed.selectedText).toHaveAttribute('font-family', `PDForge ${value}`);
      await expect(ed.selectedText).toHaveAttribute('font-weight', bold ? '700' : '400');
      await expect(ed.selectedText).toHaveAttribute('font-style', italic ? 'italic' : 'normal');
      await page.locator('.overlay-panel input[type=number]').fill('12');
      // spread the lines out: Shift + arrow moves by 10 pt
      await ed.selected.focus();
      const steps = Math.round((index - shownFonts.length / 2) * 2.8);
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
    expect(lines.length, `text lines found on page ${pageIndex + 1}`).toBe(lineCounts[pageIndex]);
    for (const [line, score] of lines.entries()) expect(score, `page ${pageIndex + 1}, line ${line + 1}`).toBeLessThan(0.01);
  }
  noErrors();
});

test('aligned, spaced and italic multi-line texts look the same in the PDF', async ({ page, context }) => {
  await openEditor(page, await samplePdf({ blankPages: 1 }));
  const ed = editor(page);
  const blocks = [
    { align: 'Align left', spacing: '1', font: 'tinos', italic: true, steps: -30 },
    { align: 'Centre', spacing: '1.5', font: 'openSans', italic: false, steps: -8 },
    { align: 'Align right', spacing: '2', font: 'ebGaramond', italic: true, steps: 14 },
  ];
  for (const block of blocks) {
    await ed.addText();
    await page.locator('.overlay-panel textarea').fill('Rövid sor\nEgy sokkal hosszabb sor, ŐŰőű\nKözepes sor');
    await page.locator('.overlay-panel .font-select').selectOption(block.font);
    await expect(ed.selectedText).toHaveAttribute('font-family', `PDForge ${block.font}`);
    await setToggle(page, 'Italic', block.italic);
    await expect(ed.selectedText).toHaveAttribute('font-style', block.italic ? 'italic' : 'normal');
    await setToggle(page, block.align);
    await page.getByLabel('Line spacing').selectOption(block.spacing);
    await page.locator('.overlay-panel input[type=number]').fill('16');
    await ed.selected.focus();
    for (let i = 0; i < Math.abs(block.steps); i++) await page.keyboard.press(block.steps < 0 ? 'Shift+ArrowUp' : 'Shift+ArrowDown');
  }
  await page.keyboard.press('Escape');
  await ed.zoomSelect.selectOption('200');
  await page.waitForTimeout(1000);
  const screenshot = await ed.surface.screenshot();
  await page.getByRole('button', { name: 'Back to pages' }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download PDF' }).click()]);
  const pdf = readFileSync((await download.path())!);
  const lines = await comparePdfWithScreenshot(context, pdf, 0, screenshot);
  expect(lines.length).toBe(9);
  for (const [line, score] of lines.entries()) expect(score, `line ${line + 1}`).toBeLessThan(0.01);
});
