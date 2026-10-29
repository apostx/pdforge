import type { PDFDocument } from 'pdf-lib';
import type { FontFamily } from '../pdf/fonts';
import type { PreparedImage, SourceImage } from '../pdf/images';

export type Rotation = 0 | 90 | 180 | 270;

/** Size and own rotation of a PDF page; width/height are of the unrotated crop box, in points. */
export interface PageBox {
  width: number;
  height: number;
  rotation: Rotation;
}

/** A file the user added. Pages point back to their source. */
export type Source =
  | { kind: 'pdf'; id: string; name: string; bytes: Uint8Array; doc: PDFDocument; boxes: PageBox[] }
  | { kind: 'image'; id: string; name: string; image: SourceImage };

/**
 * Something placed on top of a page. Positions live in the page's own, unrotated space so
 * overlays stay attached to the content when the page is rotated later:
 * (x, y) is the overlay's top-left corner as a fraction of the page width/height, measured
 * from the page's top-left. `rotation` is how the page was displayed when the overlay was
 * added; the overlay is drawn turned so that it reads upright in that orientation.
 */
interface OverlayBase {
  id: string;
  x: number;
  y: number;
  rotation: Rotation;
}

export interface TextOverlay extends OverlayBase {
  kind: 'text';
  text: string;
  family: FontFamily;
  bold: boolean;
  /** Font size in points. */
  size: number;
  color: string;
}

export interface ImageOverlay extends OverlayBase {
  kind: 'image';
  image: PreparedImage;
  /** Object URL of `image`, for display. */
  url: string;
  /** In points. */
  width: number;
  height: number;
}

/** A filled box, mostly for covering up existing content. */
export interface RectOverlay extends OverlayBase {
  kind: 'rect';
  width: number;
  height: number;
  color: string;
}

export type Overlay = TextOverlay | ImageOverlay | RectOverlay;

/** One page of the output document, in output order. */
export interface PageItem {
  id: string;
  sourceId: string;
  pageIndex: number;
  /** Extra clockwise rotation on top of the page's own. */
  rotation: Rotation;
  overlays: Overlay[];
}

export type ImagePageSize = 'a4' | 'fit';

/** How much to shrink images when exporting; 'none' keeps the original files. */
export type Compression = 'none' | 'high' | 'medium' | 'small';

export type ErrorKind = 'encrypted' | 'unsupported' | 'unreadable' | 'export';

export interface AppError {
  id: string;
  kind: ErrorKind;
  /** The file that failed to load; empty for export errors. */
  fileName: string;
}
