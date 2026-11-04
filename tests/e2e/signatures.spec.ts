import { expect, test } from '@playwright/test';

test('signatures fit their tiles, however tall', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Signatures' }).click();
  // short typed text: taller than the tile in proportion (it used to stick out)
  await page.getByRole('button', { name: 'Type' }).click();
  await page.getByRole('textbox', { name: 'Your name' }).fill('R.S.');
  await page.getByRole('button', { name: 'Save signature' }).click();
  // a tall, narrow drawn one
  await page.getByRole('button', { name: 'Draw' }).click();
  const pad = (await page.locator('.signature-pad').boundingBox())!;
  await page.mouse.move(pad.x + pad.width / 2, pad.y + 10);
  await page.mouse.down();
  await page.mouse.move(pad.x + pad.width / 2 + 5, pad.y + pad.height - 10, { steps: 10 });
  await page.mouse.up();
  await page.getByRole('button', { name: 'Save signature' }).click();
  await expect(page.locator('.signature-item .signature-tile img')).toHaveCount(2);

  for (const tile of await page.locator('.signature-item .signature-tile').all()) {
    const outer = (await tile.boundingBox())!;
    const image = (await tile.locator('img').boundingBox())!;
    expect(image.height).toBeGreaterThan(10);
    expect(image.x).toBeGreaterThanOrEqual(outer.x - 0.5);
    expect(image.y).toBeGreaterThanOrEqual(outer.y - 0.5);
    expect(image.x + image.width).toBeLessThanOrEqual(outer.x + outer.width + 0.5);
    expect(image.y + image.height).toBeLessThanOrEqual(outer.y + outer.height + 0.5);
  }
});
