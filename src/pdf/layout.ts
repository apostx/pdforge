import type { ImagePageSize, Rotation } from '../workspace/types';

// A4 in PDF points; written out so this module doesn't pull in pdf-lib.
const A4_SHORT = 595.28;
const A4_LONG = 841.89;
const MARGIN = 28.35; // 10 mm

/** Page size and image placement (PDF points, origin bottom-left) for a page made from an image. */
export interface ImagePageLayout {
  pageWidth: number;
  pageHeight: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export function imagePageLayout(imageWidth: number, imageHeight: number, size: ImagePageSize): ImagePageLayout {
  const landscape = imageWidth > imageHeight;
  const boxWidth = landscape ? A4_LONG : A4_SHORT;
  const boxHeight = landscape ? A4_SHORT : A4_LONG;

  if (size === 'fit') {
    // the page takes the image's proportions, scaled to A4 size
    const scale = Math.min(boxWidth / imageWidth, boxHeight / imageHeight);
    const width = imageWidth * scale;
    const height = imageHeight * scale;
    return { pageWidth: width, pageHeight: height, x: 0, y: 0, width, height };
  }

  const scale = Math.min((boxWidth - 2 * MARGIN) / imageWidth, (boxHeight - 2 * MARGIN) / imageHeight);
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  return { pageWidth: boxWidth, pageHeight: boxHeight, x: (boxWidth - width) / 2, y: (boxHeight - height) / 2, width, height };
}

/**
 * The PDF transformation matrix [a b c d e f] that draws an image's stored pixels (the unit
 * square) upright into `rect`, turning them clockwise by `turn` first (EXIF orientation).
 */
export function uprightImageMatrix(turn: Rotation, { x, y, width, height }: Pick<ImagePageLayout, 'x' | 'y' | 'width' | 'height'>) {
  switch (turn) {
    case 0:
      return [width, 0, 0, height, x, y];
    case 90:
      return [0, -height, width, 0, x, y + height];
    case 180:
      return [-width, 0, 0, -height, x + width, y + height];
    case 270:
      return [0, height, -width, 0, x + width, y];
  }
}
