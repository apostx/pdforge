import { expect, test } from '@playwright/test';
import { editor, openEditor, samplePdf, watchErrors } from './helpers';

test.use({ viewport: { width: 1280, height: 800 } });

test('zoom controls, keys and fit modes', async ({ page }) => {
  const noErrors = watchErrors(page);
  await openEditor(page, await samplePdf());
  const ed = editor(page);

  // fitted: nothing to scroll
  let scroll = await ed.scroll();
  expect(scroll.maxLeft).toBeLessThanOrEqual(0);
  expect(scroll.maxTop).toBeLessThanOrEqual(0);
  await expect(ed.zoomSelect).toHaveValue('page');

  const fitted = (await ed.surface.boundingBox())!;
  await page.getByRole('button', { name: 'Zoom in' }).click();
  expect(await ed.zoomLabel()).toMatch(/^\d+%$/);
  await page.keyboard.press('+');
  await page.keyboard.press('+');
  const zoomed = (await ed.surface.boundingBox())!;
  expect(zoomed.width).toBeGreaterThan(fitted.width * 1.3);
  expect((await ed.scroll()).maxTop).toBeGreaterThan(0);
  await ed.zoomSelect.selectOption('200');
  scroll = await ed.scroll();
  expect(scroll.maxLeft).toBeGreaterThan(0);
  expect(scroll.maxTop).toBeGreaterThan(0);

  await page.keyboard.press('-');
  expect(await ed.zoomLabel()).toBe('175%');
  await page.keyboard.press('0');
  await expect(ed.zoomSelect).toHaveValue('page');

  // page width: the page fills the width, scrolls only up and down
  await ed.zoomSelect.selectOption('width');
  scroll = await ed.scroll();
  expect(scroll.maxLeft).toBeLessThanOrEqual(0);
  expect(scroll.maxTop).toBeGreaterThan(0);
  expect(Math.abs((await ed.surface.boundingBox())!.width - (scroll.width - 48))).toBeLessThan(2);

  // limits
  await ed.zoomSelect.selectOption('400');
  await expect(page.getByRole('button', { name: 'Zoom in' })).toBeDisabled();
  const zoomOut = page.getByRole('button', { name: 'Zoom out' });
  while (await zoomOut.isEnabled()) await zoomOut.click();
  expect(await ed.zoomLabel()).toBe('25%');

  // typing +, - and 0 in the text field doesn't zoom
  await ed.zoomSelect.selectOption('page');
  await ed.addText();
  await page.locator('.overlay-panel textarea').fill('a+b-0');
  await expect(ed.zoomSelect).toHaveValue('page');
  noErrors();
});

test('Ctrl + wheel zooms around the pointer; wheel and drag scroll', async ({ page }) => {
  await openEditor(page, await samplePdf());
  const ed = editor(page);
  await ed.zoomSelect.selectOption('125');
  const before = (await ed.surface.boundingBox())!;
  const pointer = { x: before.x + before.width * 0.25, y: before.y + before.height * 0.3 };
  await page.mouse.move(pointer.x, pointer.y);
  await page.keyboard.down('Control');
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -100);
  await page.keyboard.up('Control');
  await expect.poll(async () => (await ed.surface.boundingBox())!.width).toBeGreaterThan(before.width * 1.5);
  const after = (await ed.surface.boundingBox())!;
  expect((pointer.x - after.x) / after.width).toBeCloseTo(0.25, 2);
  expect((pointer.y - after.y) / after.height).toBeCloseTo(0.3, 2);

  // plain wheel scrolls
  const scrolled = await ed.scroll();
  await page.mouse.wheel(0, 200);
  await expect.poll(async () => (await ed.scroll()).top).toBeGreaterThan(scrolled.top);
  expect((await ed.surface.boundingBox())!.width).toBeCloseTo(after.width, 0);

  // dragging an empty spot scrolls
  const start = await ed.scroll();
  await page.mouse.move(600, 500);
  await page.mouse.down();
  await page.mouse.move(500, 420, { steps: 5 });
  await page.mouse.up();
  const end = await ed.scroll();
  expect(end.left - start.left).toBeCloseTo(100, 0);
  expect(end.top - start.top).toBeCloseTo(80, 0);
});

test('placing and dragging items while zoomed', async ({ page }) => {
  await openEditor(page, await samplePdf());
  const ed = editor(page);
  await ed.zoomSelect.selectOption('200');
  await ed.scroller.evaluate((element) => element.scrollTo(element.scrollWidth, element.scrollHeight));

  // a new text goes in the middle of what is in view, not the middle of the page
  await ed.addText();
  const view = (await ed.scroller.boundingBox())!;
  const scroll = await ed.scroll();
  const text = (await ed.selected.boundingBox())!;
  expect(text.x + text.width / 2).toBeCloseTo(view.x + scroll.width / 2, -1);
  expect(text.y + text.height / 2).toBeCloseTo(view.y + scroll.height / 2, -1);

  // dragging follows the pointer one to one
  await page.mouse.move(text.x + 10, text.y + text.height / 2);
  await page.mouse.down();
  await page.mouse.move(text.x - 110, text.y + text.height / 2 - 70, { steps: 8 });
  await page.mouse.up();
  const moved = (await ed.selected.boundingBox())!;
  expect(moved.x - text.x).toBeCloseTo(-120, 0);
  expect(moved.y - text.y).toBeCloseTo(-70, 0);

  // held at the edge, the view scrolls along and the item stays under the pointer
  const scrollBefore = await ed.scroll();
  await page.mouse.move(moved.x + 10, moved.y + 5);
  await page.mouse.down();
  await page.mouse.move(view.x + 4, moved.y + 5, { steps: 10 });
  await expect.poll(async () => (await ed.scroll()).left, { timeout: 3000 }).toBeLessThan(scrollBefore.left - 100);
  const held = (await ed.selected.boundingBox())!;
  await page.mouse.up();
  expect(held.x + 10).toBeLessThan(view.x + 40);
  const stopped = (await ed.scroll()).left;
  await page.waitForTimeout(300);
  expect((await ed.scroll()).left).toBe(stopped);
});

test('zoom is kept across pages, and dragging works on a turned page', async ({ page }) => {
  await openEditor(page, await samplePdf());
  const ed = editor(page);
  await ed.zoomSelect.selectOption('150');
  await page.getByRole('button', { name: 'Next page' }).click();
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(ed.zoomSelect).toHaveValue('150');
  await ed.addText();
  const text = (await ed.selected.boundingBox())!;
  await page.mouse.move(text.x + 10, text.y + text.height / 2);
  await page.mouse.down();
  await page.mouse.move(text.x + 70, text.y + text.height / 2 + 40, { steps: 5 });
  await page.mouse.up();
  const moved = (await ed.selected.boundingBox())!;
  expect(moved.x - text.x).toBeCloseTo(60, 0);
  expect(moved.y - text.y).toBeCloseTo(40, 0);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 412, height: 839 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2.625 });

  test('pinching zooms the page, not the app', async ({ page, context }) => {
    await openEditor(page, await samplePdf());
    const ed = editor(page);
    const cdp = await context.newCDPSession(page);
    const touch = (type: string, points: [number, number][]) =>
      cdp.send('Input.dispatchTouchEvent', { type: type as 'touchStart', touchPoints: points.map(([x, y], id) => ({ x, y, id })) });
    const view = (await ed.scroller.boundingBox())!;
    const before = (await ed.surface.boundingBox())!;
    const centre = { x: view.x + view.width / 2 - 40, y: view.y + view.height / 2 - 30 };
    const fraction = { x: (centre.x - before.x) / before.width, y: (centre.y - before.y) / before.height };
    await touch('touchStart', [[centre.x - 30, centre.y], [centre.x + 30, centre.y]]);
    for (let i = 1; i <= 10; i++) await touch('touchMove', [[centre.x - 30 - i * 9, centre.y], [centre.x + 30 + i * 9, centre.y]]);
    await touch('touchEnd', []);
    await expect.poll(async () => (await ed.surface.boundingBox())!.width).toBeGreaterThan(before.width * 2);
    const after = (await ed.surface.boundingBox())!;
    expect((centre.x - after.x) / after.width).toBeCloseTo(fraction.x, 2);
    expect((centre.y - after.y) / after.height).toBeCloseTo(fraction.y, 2);
    expect(await page.evaluate(() => window.visualViewport!.scale)).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  });
});

test.describe('on a sharp screen', () => {
  test.use({ deviceScaleFactor: 2 });

  test('far zoomed in, the part in view is rendered at full resolution', async ({ page }) => {
    await openEditor(page, await samplePdf());
    const ed = editor(page);
    const detail = page.locator('.page-surface__detail');
    await expect(detail).toHaveCount(0);
    await ed.zoomSelect.selectOption('300');
    await expect(detail).toHaveCount(1);
    const sizes = await detail.evaluate((img: HTMLImageElement) => {
      const shown = img.getBoundingClientRect();
      const view = document.querySelector('.editor__scroller')!.getBoundingClientRect();
      const page = document.querySelector('.editor .page-surface')!.getBoundingClientRect();
      return {
        ratio: Math.max(img.naturalWidth, img.naturalHeight) / Math.max(shown.width, shown.height),
        covers:
          shown.left <= Math.max(view.left, page.left) + 1 &&
          shown.top <= Math.max(view.top, page.top) + 1 &&
          shown.right >= Math.min(view.right, page.right) - 1 &&
          shown.bottom >= Math.min(view.bottom, page.bottom) - 1,
      };
    });
    expect(sizes.ratio).toBeGreaterThan(1.9);
    expect(sizes.covers).toBe(true);
    // scrolled: the new view is rendered
    const first = await detail.getAttribute('src');
    await ed.scroller.evaluate((element) => element.scrollBy(300, 500));
    await expect.poll(() => detail.getAttribute('src')).not.toBe(first);
    // zoomed out: the whole-page rendering is sharp enough again
    await ed.zoomSelect.selectOption('page');
    await expect(detail).toHaveCount(0);
  });
});
