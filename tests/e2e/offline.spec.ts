import { expect, test } from '@playwright/test';
import { editor, openEditor, samplePdf } from './helpers';

test.use({ serviceWorkers: 'allow' });

test('fonts offline: the defaults always, others once they have been used', async ({ page, context }) => {
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  const precached = await page.evaluate(async () => {
    const names: string[] = [];
    for (const key of await caches.keys()) for (const request of await (await caches.open(key)).keys()) names.push(request.url);
    return names.filter((url) => url.endsWith('.ttf')).map((url) => url.split('/').pop()!);
  });
  expect(precached.some((name) => name.startsWith('OpenSans_400Regular'))).toBe(true);
  expect(precached.some((name) => name.startsWith('Roboto_'))).toBe(false);

  await context.setOffline(true);
  await openEditor(page, await samplePdf());
  const ed = editor(page);
  await ed.addText();
  await expect(ed.selectedText).toHaveAttribute('font-family', 'PDForge openSans');
  const fontSelect = page.locator('.overlay-panel .font-select');
  await fontSelect.selectOption('roboto');
  await expect(page.locator('.overlay-panel .form-error')).toBeVisible();

  await context.setOffline(false);
  await fontSelect.selectOption('roboto');
  await expect(ed.selectedText).toHaveAttribute('font-family', 'PDForge roboto');
  await expect
    .poll(() => page.evaluate(async () => (await (await caches.open('pdforge-runtime')).keys()).some((r) => r.url.includes('Roboto_400Regular'))))
    .toBe(true);

  await context.setOffline(true);
  const url = await page.evaluate(async () => (await (await caches.open('pdforge-runtime')).keys()).find((r) => r.url.includes('Roboto_400Regular'))!.url);
  expect(await page.evaluate(async (fontUrl) => (await fetch(fontUrl)).ok, url)).toBe(true);
});
