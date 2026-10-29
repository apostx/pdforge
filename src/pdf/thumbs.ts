// Thumbnail helpers shared by image and PDF loading. Kept free of pdf.js so that
// loading images doesn't pull it in.

export interface Thumb {
  url: string;
}

/** Longest side of a thumbnail in CSS pixels. */
const THUMB_SIZE = 220;

export function thumbPixels(): number {
  return THUMB_SIZE * Math.min(window.devicePixelRatio || 1, 2);
}

export function canvasToUrl(canvas: HTMLCanvasElement, quality: number): Promise<string> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(URL.createObjectURL(blob)) : reject(new Error('toBlob failed'))),
      'image/jpeg',
      quality,
    );
  });
}

export async function bitmapThumb(bitmap: ImageBitmap): Promise<Thumb> {
  const scale = Math.min(1, thumbPixels() / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d')!;
  // JPEG has no alpha, so give transparent images the same white a PDF page has
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return { url: await canvasToUrl(canvas, 0.85) };
}
