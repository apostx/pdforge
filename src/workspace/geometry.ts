import { imagePageLayout } from '../pdf/layout';
import type { ImagePageSize, PageItem, Rotation, Source } from './types';

export interface Vec {
  x: number;
  y: number;
}

/** Rotates a screen-style (y down) vector clockwise by a multiple of 90°. */
export function rotateVec({ x, y }: Vec, degrees: number): Vec {
  switch ((((degrees % 360) + 360) % 360) as Rotation) {
    case 0:
      return { x, y };
    case 90:
      return { x: -y, y: x };
    case 180:
      return { x: -x, y: -y };
    case 270:
      return { x: y, y: -x };
  }
}

export function addRotation(a: number, b: number): Rotation {
  return ((((a + b) % 360) + 360) % 360) as Rotation;
}

/** How a page is shown: its unrotated size in points, total rotation, and for image pages where the image sits. */
export interface PageGeometry {
  width: number;
  height: number;
  rotation: Rotation;
  /** Image pages only: image placement as fractions of the page, from the top-left. */
  imageRect?: { x: number; y: number; width: number; height: number };
}

export function pageGeometry(page: PageItem, source: Source, imagePageSize: ImagePageSize): PageGeometry {
  if (source.kind === 'pdf') {
    const box = source.boxes[page.pageIndex];
    return { width: box.width, height: box.height, rotation: addRotation(box.rotation, page.rotation) };
  }
  const layout = imagePageLayout(source.image.width, source.image.height, imagePageSize);
  return {
    width: layout.pageWidth,
    height: layout.pageHeight,
    rotation: page.rotation,
    imageRect: {
      x: layout.x / layout.pageWidth,
      y: 1 - (layout.y + layout.height) / layout.pageHeight,
      width: layout.width / layout.pageWidth,
      height: layout.height / layout.pageHeight,
    },
  };
}

/**
 * Converts a point on the page as shown (points, from the top-left of the rotated page)
 * to the page's own unrotated space (points, from its top-left).
 */
export function displayToPage(geometry: PageGeometry, { x, y }: Vec): Vec {
  const { width, height } = geometry;
  switch (geometry.rotation) {
    case 0:
      return { x, y };
    case 90:
      return { x: y, y: height - x };
    case 180:
      return { x: width - x, y: height - y };
    case 270:
      return { x: width - y, y: x };
  }
}

/**
 * Top-left anchor (as page fractions) that centres a box of `width`×`height` points,
 * drawn with the given overlay rotation, on the page.
 */
export function centredAnchor(geometry: PageGeometry, width: number, height: number, rotation: Rotation): Vec {
  // the overlay's own axes are the page's turned counter-clockwise by `rotation`
  const halfDiagonal = rotateVec({ x: width / 2, y: height / 2 }, -rotation);
  return {
    x: 0.5 - halfDiagonal.x / geometry.width,
    y: 0.5 - halfDiagonal.y / geometry.height,
  };
}
