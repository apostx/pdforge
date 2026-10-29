import type { Rotation } from '../workspace/types';
import { bitmapThumb, thumbPixels, type Thumb } from './thumbs';

/** A small image held in memory (placed images, signatures), ready for pdf-lib. */
export interface PreparedImage {
  bytes: Uint8Array;
  format: 'jpg' | 'png';
  width: number;
  height: number;
}

/**
 * An image added as a page. Only a reference to the file is kept (a Blob is backed by the
 * file on disk), so even hundreds of megabytes of photos don't sit in memory.
 */
export interface SourceImage {
  blob: Blob;
  format: 'jpg' | 'png';
  /** Upright size in pixels, after EXIF rotation. */
  width: number;
  height: number;
  /** Clockwise turn that shows the stored pixels upright (from EXIF); applied when drawing. */
  turn: Rotation;
  /** JPEG colour components (1 grey, 3 RGB, 4 CMYK). */
  components: number;
}

export class UnsupportedImageError extends Error {}

// Re-encoded images are scaled below this, which keeps them under Safari's canvas size limit.
const MAX_PIXELS = 16_000_000;

interface ImageInfo {
  format: 'jpg' | 'png' | 'other';
  /** Stored size, before EXIF rotation; 0 if the header couldn't be read. */
  width: number;
  height: number;
  orientation: number;
  components: number;
}

/** Reads size, EXIF orientation and colour components from the start of the file, without decoding it. */
async function inspectImage(blob: Blob): Promise<ImageInfo> {
  const bytes = new Uint8Array(await blob.slice(0, 512 * 1024).arrayBuffer());
  const view = new DataView(bytes.buffer);
  const info: ImageInfo = { format: 'other', width: 0, height: 0, orientation: 1, components: 3 };

  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes.length >= 24) {
    return { ...info, format: 'png', width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (!(bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)) return info;

  info.format = 'jpg';
  try {
    let offset = 2;
    while (offset + 4 <= view.byteLength) {
      const marker = view.getUint16(offset);
      if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) break; // start of scan: no more headers
      const length = view.getUint16(offset + 2);
      // SOF0–SOF15, except DHT (C4), JPG (C8) and DAC (CC)
      if (marker >= 0xffc0 && marker <= 0xffcf && marker !== 0xffc4 && marker !== 0xffc8 && marker !== 0xffcc) {
        info.height = view.getUint16(offset + 5);
        info.width = view.getUint16(offset + 7);
        info.components = view.getUint8(offset + 9);
      } else if (marker === 0xffe1 && view.getUint32(offset + 4) === 0x45786966 /* "Exif" */) {
        const tiff = offset + 10;
        const little = view.getUint16(tiff) === 0x4949; // "II"
        const ifd = tiff + view.getUint32(tiff + 4, little);
        const entries = view.getUint16(ifd, little);
        for (let i = 0; i < entries; i++) {
          const entry = ifd + 2 + i * 12;
          if (view.getUint16(entry, little) === 0x0112) info.orientation = view.getUint16(entry + 8, little);
        }
      }
      offset += 2 + length;
    }
  } catch {
    // truncated or malformed headers: whatever was found so far stands
  }
  return info;
}

/** EXIF orientations that are pure rotations; the mirrored ones (2, 4, 5, 7) get re-encoded. */
const TURNS: Record<number, Rotation> = { 1: 0, 3: 180, 6: 90, 8: 270 };

function hasTransparency(context: CanvasRenderingContext2D, width: number, height: number): boolean {
  const { data } = context.getImageData(0, 0, width, height);
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 255) return true;
  }
  return false;
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))), type, 0.92);
  });
}

async function reencode(bitmap: ImageBitmap, mayHaveAlpha: boolean): Promise<{ blob: Blob; format: 'jpg' | 'png'; width: number; height: number }> {
  const scale = Math.min(1, Math.sqrt(MAX_PIXELS / (bitmap.width * bitmap.height)));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: mayHaveAlpha })!;
  context.drawImage(bitmap, 0, 0, width, height);

  // PNG keeps transparency; JPEG is far smaller for photos
  const format = mayHaveAlpha && hasTransparency(context, width, height) ? 'png' : 'jpg';
  const blob = await canvasToBlob(canvas, format === 'png' ? 'image/png' : 'image/jpeg');
  return { blob, format, width, height };
}

async function decode(blob: Blob, options?: ImageBitmapOptions): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(blob, { imageOrientation: 'from-image', ...options });
  } catch {
    throw new UnsupportedImageError();
  }
}

async function reencodeFile(blob: Blob, mayHaveAlpha: boolean): Promise<SourceImage> {
  const bitmap = await decode(blob);
  try {
    return { ...(await reencode(bitmap, mayHaveAlpha)), turn: 0, components: 3 };
  } finally {
    bitmap.close();
  }
}

/** Prepares an image file to become a page. Upright and EXIF-rotated JPEGs and PNGs are used as they are. */
export async function prepareSourceImage(file: File): Promise<SourceImage> {
  const info = await inspectImage(file);
  const turn = TURNS[info.orientation];
  if (info.width > 0 && info.format === 'png') {
    return { blob: file, format: 'png', width: info.width, height: info.height, turn: 0, components: 3 };
  }
  if (info.width > 0 && info.format === 'jpg' && turn !== undefined) {
    const quarter = turn % 180 !== 0;
    return {
      blob: file,
      format: 'jpg',
      width: quarter ? info.height : info.width,
      height: quarter ? info.width : info.height,
      turn,
      components: info.components,
    };
  }
  // WebP, GIF, AVIF, HEIC (where the browser can decode it), mirrored photos…
  return reencodeFile(file, info.format !== 'jpg');
}

/** A thumbnail decoded straight at thumbnail size: far less memory and time than decoding the full photo. */
export async function sourceThumb(image: SourceImage): Promise<Thumb> {
  const scale = Math.min(1, thumbPixels() / Math.max(image.width, image.height));
  const bitmap = await decode(image.blob, {
    resizeWidth: Math.max(1, Math.round(image.width * scale)),
    resizeHeight: Math.max(1, Math.round(image.height * scale)),
    resizeQuality: 'medium',
  });
  try {
    return await bitmapThumb(bitmap);
  } finally {
    bitmap.close();
  }
}

/** Prepares an image placed on a page; these are small and kept in memory. */
export async function prepareOverlayImage(file: File): Promise<PreparedImage> {
  let image = await prepareSourceImage(file);
  // overlays are drawn without EXIF handling, so bake the rotation into the pixels
  if (image.turn !== 0) image = await reencodeFile(image.blob, false);
  return { bytes: new Uint8Array(await image.blob.arrayBuffer()), format: image.format, width: image.width, height: image.height };
}

export function imageObjectUrl(image: PreparedImage | SourceImage): string {
  if ('blob' in image) return URL.createObjectURL(image.blob);
  return URL.createObjectURL(new Blob([image.bytes as BlobPart], { type: image.format === 'png' ? 'image/png' : 'image/jpeg' }));
}
