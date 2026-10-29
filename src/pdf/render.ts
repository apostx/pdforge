import { getDocument, GlobalWorkerOptions, type PDFDocumentLoadingTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { canvasToUrl, thumbPixels, type Thumb } from './thumbs';

GlobalWorkerOptions.workerSrc = workerUrl;

// Absolute, because the worker resolves relative URLs against its own location.
const assetBase = new URL('pdfjs/', document.baseURI).href;

function openPdf(bytes: Uint8Array): PDFDocumentLoadingTask {
  return getDocument({
    // pdf.js transfers the buffer to its worker, and we still need ours for export
    data: bytes.slice(),
    cMapUrl: `${assetBase}cmaps/`,
    standardFontDataUrl: `${assetBase}standard_fonts/`,
    wasmUrl: `${assetBase}wasm/`,
    iccUrl: `${assetBase}iccs/`,
  });
}

/**
 * Renders a page unrotated (rotation is applied on screen with CSS, together with the
 * overlays), so that its longest side is `longSide` device pixels.
 */
async function renderPage(task: PDFDocumentLoadingTask, pageIndex: number, longSide: number, quality: number) {
  const doc = await task.promise;
  const page = await doc.getPage(pageIndex + 1);
  const natural = page.getViewport({ scale: 1, rotation: 0 });
  const viewport = page.getViewport({ scale: longSide / Math.max(natural.width, natural.height), rotation: 0 });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await page.render({ canvas, viewport }).promise;
  page.cleanup();
  return canvasToUrl(canvas, quality);
}

/**
 * Renders the given pages of a PDF, one at a time, calling `onThumb` with each one's
 * position in `pageIndices` as it finishes. Stops early once `isAbandoned` returns true
 * (the pages were removed meanwhile).
 */
export async function renderPdfThumbs(
  bytes: Uint8Array,
  pageIndices: number[],
  onThumb: (index: number, thumb: Thumb) => void,
  isAbandoned: () => boolean,
): Promise<void> {
  const task = openPdf(bytes);
  try {
    for (let index = 0; index < pageIndices.length && !isAbandoned(); index++) {
      onThumb(index, { url: await renderPage(task, pageIndices[index], thumbPixels(), 0.85) });
    }
  } finally {
    await task.destroy();
  }
}

// The editor keeps the document it is showing open, so stepping through pages is quick.
let editorDocument: { bytes: Uint8Array; task: PDFDocumentLoadingTask } | null = null;

/** Renders one page for the editor; the returned object URL belongs to the caller. */
export function renderPdfPage(bytes: Uint8Array, pageIndex: number, longSide: number): Promise<string> {
  if (editorDocument?.bytes !== bytes) {
    void editorDocument?.task.destroy();
    editorDocument = { bytes, task: openPdf(bytes) };
  }
  return renderPage(editorDocument.task, pageIndex, longSide, 0.92);
}

export function closeEditorDocument(): void {
  void editorDocument?.task.destroy();
  editorDocument = null;
}
