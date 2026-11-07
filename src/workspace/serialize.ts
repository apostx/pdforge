import { FONT_FAMILIES, DEFAULT_FONT_FAMILY, type FontFamily } from '../pdf/fontCatalog';
import { LINE_HEIGHT, type TextAlign } from '../pdf/fonts';
import type { PreparedImage } from '../pdf/images';
import type { ImageOverlay, Overlay, Rotation } from './types';

// Overlays in a form that can be stored (in the browser, or inside an exported PDF) and read
// back. Placed images are kept apart and referred to by key, so an image used many times (a
// signature on every page) is stored once. Data read back may come from any PDF someone opens,
// so it is checked field by field and anything unexpected is dropped.

export type StoredOverlay = Exclude<Overlay, ImageOverlay> | (Omit<ImageOverlay, 'image' | 'url'> & { image: string });

export interface StoredImageInfo {
  format: 'jpg' | 'png';
  width: number;
  height: number;
}

const keys = new WeakMap<PreparedImage, string>();

/** A stable key for an image, the same for every overlay that shows it. */
export function imageKey(image: PreparedImage): string {
  let key = keys.get(image);
  if (!key) {
    key = crypto.randomUUID();
    keys.set(image, key);
  }
  return key;
}

/** Converts overlays for storing, collecting the images they use into `images`. */
export function storeOverlays(overlays: Overlay[], images: Map<string, PreparedImage>): StoredOverlay[] {
  return overlays.map((overlay) => {
    if (overlay.kind !== 'image') return overlay;
    const { image, url: _url, ...rest } = overlay;
    const key = imageKey(image);
    images.set(key, image);
    return { ...rest, image: key };
  });
}

/** An image read back, registered under its old key so storing it again doesn't copy it. */
export function restoredImage(key: string, info: StoredImageInfo, bytes: Uint8Array): PreparedImage {
  const image: PreparedImage = { bytes, format: info.format, width: info.width, height: info.height };
  keys.set(image, key);
  return image;
}

const ROTATIONS: Rotation[] = [0, 90, 180, 270];
const ALIGNS: TextAlign[] = ['left', 'center', 'right'];
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isRotation = (value: unknown): value is Rotation => ROTATIONS.includes(value as Rotation);
const isColor = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function parseImageInfo(value: unknown): StoredImageInfo | null {
  const info = value as Partial<StoredImageInfo> | null;
  if (!info || (info.format !== 'jpg' && info.format !== 'png')) return null;
  if (!isNumber(info.width) || !isNumber(info.height) || info.width <= 0 || info.height <= 0) return null;
  return { format: info.format, width: info.width, height: info.height };
}

/**
 * Reads a stored overlay back; null if it isn't a valid one. `image` turns an image key into
 * the image and its display URL (null when the image is missing).
 */
export function restoreOverlay(
  value: unknown,
  image: (key: string) => { image: PreparedImage; url: string } | null,
  newIds: boolean,
): Overlay | null {
  const stored = value as Record<string, unknown> | null;
  if (!stored || typeof stored !== 'object') return null;
  const { x, y, rotation } = stored;
  if (!isNumber(x) || !isNumber(y) || !isRotation(rotation)) return null;
  const id = newIds || typeof stored.id !== 'string' ? crypto.randomUUID() : stored.id;
  const base = { id, x: clamp(x, -1, 2), y: clamp(y, -1, 2), rotation };
  const size = (value: unknown) => (isNumber(value) && value > 0 ? Math.min(value, 100_000) : null);

  switch (stored.kind) {
    case 'text': {
      if (typeof stored.text !== 'string' || !isNumber(stored.size) || !isColor(stored.color)) return null;
      const family: FontFamily = typeof stored.family === 'string' && stored.family in FONT_FAMILIES ? (stored.family as FontFamily) : DEFAULT_FONT_FAMILY;
      // italic, align and lineSpacing came later; texts kept or exported before them get the defaults
      return {
        ...base,
        kind: 'text',
        text: stored.text.slice(0, 100_000),
        family,
        bold: stored.bold === true,
        italic: stored.italic === true,
        size: clamp(stored.size, 4, 300),
        color: stored.color,
        align: ALIGNS.includes(stored.align as TextAlign) ? (stored.align as TextAlign) : 'left',
        lineSpacing: isNumber(stored.lineSpacing) ? clamp(stored.lineSpacing, 0.8, 3) : LINE_HEIGHT,
      };
    }
    case 'rect': {
      const width = size(stored.width);
      const height = size(stored.height);
      if (!width || !height || !isColor(stored.color)) return null;
      return { ...base, kind: 'rect', width, height, color: stored.color };
    }
    case 'image': {
      const width = size(stored.width);
      const height = size(stored.height);
      const found = typeof stored.image === 'string' ? image(stored.image) : null;
      if (!width || !height || !found) return null;
      return { ...base, kind: 'image', width, height, image: found.image, url: found.url };
    }
    default:
      return null;
  }
}

export function parseRotation(value: unknown): Rotation {
  return isRotation(value) ? value : 0;
}
