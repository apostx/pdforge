import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { BrowserContext } from '@playwright/test';

const require = createRequire(import.meta.url);
const pdfjsDir = require.resolve('pdfjs-dist/build/pdf.mjs').replace(/pdf\.mjs$/, '');
const ORIGIN = 'http://compare.test';

/**
 * Renders page `pageIndex` of `pdf` with pdf.js at the size of `screenshot`, and compares the two
 * line by line: for each band of rows holding ink, the share of ink in either image with no ink
 * within 2 px in the other. 0 means identical up to anti-aliasing; a missing, swapped or shifted
 * glyph gives several percent.
 */
export async function comparePdfWithScreenshot(context: BrowserContext, pdf: Buffer, pageIndex: number, screenshot: Buffer): Promise<number[]> {
  await context.route(`${ORIGIN}/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>compare</title>' });
    return route.fulfill({ contentType: 'text/javascript', body: readFileSync(pdfjsDir + path.slice(1)) });
  });
  const page = await context.newPage();
  await page.goto(`${ORIGIN}/`);
  try {
    return await page.evaluate(
      async ({ pdfBase64, pageIndex, pngBase64 }) => {
        const pdfjs = await import(`${location.origin}/pdf.mjs`);
        pdfjs.GlobalWorkerOptions.workerSrc = `${location.origin}/pdf.worker.mjs`;
        const image = new Image();
        image.src = `data:image/png;base64,${pngBase64}`;
        await image.decode();
        const { width, height } = image;

        const doc = await pdfjs.getDocument({ data: Uint8Array.from(atob(pdfBase64), (c) => c.charCodeAt(0)) }).promise;
        const pdfPage = await doc.getPage(pageIndex + 1);
        const natural = pdfPage.getViewport({ scale: 1 });
        const viewport = pdfPage.getViewport({ scale: width / natural.width });
        const rendered = document.createElement('canvas');
        rendered.width = width;
        rendered.height = height;
        await pdfPage.render({ canvas: rendered, viewport }).promise;

        const inkOf = (source: CanvasImageSource) => {
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext('2d')!;
          context.fillStyle = '#fff';
          context.fillRect(0, 0, width, height);
          context.drawImage(source, 0, 0, width, height);
          const { data } = context.getImageData(0, 0, width, height);
          const ink = new Uint8Array(width * height);
          for (let i = 0; i < ink.length; i++) ink[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2] < 140 ? 1 : 0;
          return ink;
        };
        const grow = (mask: Uint8Array, r: number) => {
          const across = new Uint8Array(mask.length);
          for (let y = 0; y < height; y++)
            for (let x = 0; x < width; x++) {
              let hit = 0;
              for (let d = -r; d <= r && !hit; d++) hit = mask[y * width + Math.min(width - 1, Math.max(0, x + d))];
              across[y * width + x] = hit;
            }
          const out = new Uint8Array(mask.length);
          for (let y = 0; y < height; y++)
            for (let x = 0; x < width; x++) {
              let hit = 0;
              for (let d = -r; d <= r && !hit; d++) hit = across[Math.min(height - 1, Math.max(0, y + d)) * width + x];
              out[y * width + x] = hit;
            }
          return out;
        };
        const a = inkOf(image);
        const b = inkOf(rendered);
        const grownA = grow(a, 2);
        const grownB = grow(b, 2);
        const scores: number[] = [];
        let line: { miss: number; ink: number } | null = null;
        let gap = 0;
        for (let y = 0; y < height; y++) {
          let miss = 0;
          let ink = 0;
          for (let x = 0; x < width; x++) {
            const i = y * width + x;
            ink += a[i] + b[i];
            if ((a[i] && !grownB[i]) || (b[i] && !grownA[i])) miss++;
          }
          if (ink > 0) {
            line ??= { miss: 0, ink: 0 };
            line.miss += miss;
            line.ink += ink;
            gap = 0;
          } else if (line && ++gap > 3) {
            scores.push(line.miss / line.ink);
            line = null;
          }
        }
        if (line) scores.push(line.miss / line.ink);
        return scores;
      },
      { pdfBase64: pdf.toString('base64'), pageIndex, pngBase64: screenshot.toString('base64') },
    );
  } finally {
    await page.close();
    await context.unroute(`${ORIGIN}/**`);
  }
}
