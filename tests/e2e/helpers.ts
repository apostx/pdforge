import { expect, type Page } from '@playwright/test';
import { degrees, PDFDocument, rgb, StandardFonts } from 'pdf-lib';

/** A4 pages in points. */
export const A4 = { width: 595.28, height: 841.89 };

/** A test PDF: an A4 page with a grid, a landscape page and a page turned by /Rotate 90; or blank pages. */
export async function samplePdf({ blankPages = 0 } = {}): Promise<Buffer> {
  const doc = await PDFDocument.create();
  if (blankPages > 0) {
    for (let i = 0; i < blankPages; i++) doc.addPage([A4.width, A4.height]);
    return Buffer.from(await doc.save());
  }
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const sizes: [number, number, number][] = [
    [A4.width, A4.height, 0],
    [A4.height, A4.width, 0],
    [A4.width, A4.height, 90],
  ];
  for (const [index, [width, height, rotation]] of sizes.entries()) {
    const page = doc.addPage([width, height]);
    for (let x = 0; x <= width; x += 50) page.drawLine({ start: { x, y: 0 }, end: { x, y: height }, thickness: 0.5, color: rgb(0.8, 0.85, 0.95) });
    for (let y = 0; y <= height; y += 50) page.drawLine({ start: { x: 0, y }, end: { x: width, y }, thickness: 0.5, color: rgb(0.8, 0.85, 0.95) });
    page.drawText(`Page ${index + 1}`, { x: 60, y: height - 80, size: 28, font });
    if (rotation) page.setRotation(degrees(rotation));
  }
  return Buffer.from(await doc.save());
}

/** Adds a PDF and opens the editor on its first page. */
export async function openEditor(page: Page, pdf: Buffer): Promise<void> {
  await page.goto('/');
  await page.locator('input[type=file][accept*="pdf"]').first().setInputFiles({ name: 'test.pdf', mimeType: 'application/pdf', buffer: pdf });
  const card = page.locator('.page-card').first();
  await card.waitFor();
  await card.hover();
  await card.getByRole('button', { name: /^Edit page/ }).click();
  await expect(page.locator('.editor .page-surface')).toBeVisible();
}

export const editor = (page: Page) => ({
  surface: page.locator('.editor .page-surface'),
  scroller: page.locator('.editor__scroller'),
  zoomSelect: page.locator('.editor__zoom-select'),
  zoomLabel: () => page.locator('.editor__zoom-select option:checked').textContent(),
  selected: page.locator('.editor .overlay--selected'),
  selectedText: page.locator('.editor .overlay--selected svg text'),
  addText: () => page.locator('.editor__tools').getByRole('button', { name: 'Text', exact: true }).click(),
  scroll: () =>
    page.locator('.editor__scroller').evaluate((element) => ({
      left: element.scrollLeft,
      top: element.scrollTop,
      maxLeft: element.scrollWidth - element.clientWidth,
      maxTop: element.scrollHeight - element.clientHeight,
      width: element.clientWidth,
      height: element.clientHeight,
    })),
});

/** Fails the test on any uncaught error or console error in the page. */
export function watchErrors(page: Page): () => void {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
  return () => expect(errors).toEqual([]);
}

/** Sets a toggle button in the item panel (Bold, Italic, an alignment) to pressed or not. */
export async function setToggle(page: Page, name: string, pressed = true): Promise<void> {
  const button = page.locator('.overlay-panel').getByRole('button', { name, exact: true });
  if ((await button.getAttribute('aria-pressed')) !== String(pressed)) await button.click();
  await expect(button).toHaveAttribute('aria-pressed', String(pressed));
}
