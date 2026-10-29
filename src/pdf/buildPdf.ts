import {
  concatTransformationMatrix,
  degrees,
  drawObject,
  PDFDocument,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from 'pdf-lib';
import type { ImagePageSize, Overlay, PageItem, Source } from '../workspace/types';
import { compressEmbeddedImages, type EmbeddedCompression } from './compressEmbedded';
import { fontFeatures, fontKey, layoutText, loadFont, loadFontkit, type FontStyle, type LoadedFont } from './fonts';
import type { PreparedImage, SourceImage } from './images';
import { imagePageLayout, uprightImageMatrix } from './layout';

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function hexToRgb(hex: string) {
  const value = parseInt(hex.slice(1), 16);
  return rgb(((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255);
}

/**
 * Wraps the page's existing content in q…Q, so a graphics state it leaves behind
 * (a stray transform, say) can't shift what we draw on top.
 */
function isolateExistingContent(page: PDFPage) {
  const { context } = page.doc;
  page.node.normalize();
  page.node.wrapContentStreams(
    context.register(context.contentStream([pushGraphicsState()])),
    context.register(context.contentStream([popGraphicsState()])),
  );
}

/** Embeds fonts and images on first use, so each is stored in the output once. */
class Resources {
  private fonts = new Map<string, Promise<{ loaded: LoadedFont; embedded: PDFFont }>>();
  private images = new Map<PreparedImage | SourceImage, Promise<PDFImage>>();

  constructor(private doc: PDFDocument) {}

  font(style: FontStyle) {
    const key = fontKey(style);
    let font = this.fonts.get(key);
    if (!font) {
      font = loadFont(style).then(async (loaded) => {
        this.doc.registerFontkit(await loadFontkit());
        return { loaded, embedded: await this.doc.embedFont(loaded.bytes, { subset: true, features: fontFeatures }) };
      });
      this.fonts.set(key, font);
    }
    return font;
  }

  image(image: PreparedImage | SourceImage) {
    let embedded = this.images.get(image);
    if (!embedded) {
      embedded = ('blob' in image ? image.blob.arrayBuffer() : Promise.resolve(image.bytes)).then((bytes) =>
        image.format === 'png' ? this.doc.embedPng(bytes) : this.doc.embedJpg(bytes),
      );
      this.images.set(image, embedded);
    }
    return embedded;
  }
}

async function drawOverlay(page: PDFPage, overlay: Overlay, box: Box, resources: Resources) {
  // PDF space has y pointing up; the overlay's own axes are turned counter-clockwise by its rotation
  const angle = (overlay.rotation * Math.PI) / 180;
  const right = { x: Math.cos(angle), y: Math.sin(angle) };
  const down = { x: Math.sin(angle), y: -Math.cos(angle) };
  const anchorX = box.x + overlay.x * box.width;
  const anchorY = box.y + (1 - overlay.y) * box.height;
  /** A point given in the overlay's own frame (points, y down from its top-left). */
  const at = (dx: number, dy: number) => ({
    x: anchorX + right.x * dx + down.x * dy,
    y: anchorY + right.y * dx + down.y * dy,
  });
  const rotate = degrees(overlay.rotation);

  switch (overlay.kind) {
    case 'text': {
      const { loaded, embedded } = await resources.font(overlay);
      const layout = layoutText(loaded.font, overlay.text, overlay.size);
      const color = hexToRgb(overlay.color);
      layout.lines.forEach((line, index) => {
        if (!line) return;
        const baseline = at(0, layout.ascent + index * layout.lineHeight);
        page.drawText(line, { ...baseline, size: overlay.size, font: embedded, color, rotate });
      });
      break;
    }
    case 'image': {
      const image = await resources.image(overlay.image);
      page.drawImage(image, { ...at(0, overlay.height), width: overlay.width, height: overlay.height, rotate });
      break;
    }
    case 'rect':
      page.drawRectangle({
        ...at(0, overlay.height),
        width: overlay.width,
        height: overlay.height,
        color: hexToRgb(overlay.color),
        rotate,
      });
      break;
  }
}

export interface BuildOptions {
  imagePageSize: ImagePageSize;
  /** The image to use for an image page, so a compressed copy can stand in for the original. */
  imageFor: (source: Extract<Source, { kind: 'image' }>) => SourceImage;
  /** Recompress the pictures inside PDF pages too. */
  compressEmbedded?: EmbeddedCompression;
}

export async function buildPdf(pages: PageItem[], sources: Source[], { imagePageSize, imageFor, compressEmbedded }: BuildOptions): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  out.setProducer('PDForge');
  out.setCreator('PDForge');
  const resources = new Resources(out);

  // Copy all pages taken from one PDF in a single call, so resources they share
  // (fonts, images) end up in the output once instead of once per page.
  const copied = new Map<string, PDFPage>();
  for (const source of sources) {
    if (source.kind !== 'pdf') continue;
    const items = pages.filter((page) => page.sourceId === source.id);
    if (items.length === 0) continue;
    const copies = await out.copyPages(source.doc, items.map((item) => item.pageIndex));
    items.forEach((item, i) => copied.set(item.id, copies[i]));
  }
  if (compressEmbedded && copied.size > 0) await compressEmbeddedImages(out, [...copied.values()], compressEmbedded);

  const sourcesById = new Map(sources.map((source) => [source.id, source]));
  for (const item of pages) {
    const source = sourcesById.get(item.sourceId)!;
    let page: PDFPage;
    let box: Box;

    if (source.kind === 'pdf') {
      page = out.addPage(copied.get(item.id)!);
      const angle = page.getRotation().angle + item.rotation;
      page.setRotation(degrees(((angle % 360) + 360) % 360));
      box = page.getCropBox();
      if (item.overlays.length > 0) isolateExistingContent(page);
    } else {
      // laid out by the original, so a compressed copy lands exactly where the editor showed it
      const layout = imagePageLayout(source.image.width, source.image.height, imagePageSize);
      const image = imageFor(source);
      page = out.addPage([layout.pageWidth, layout.pageHeight]);
      // drawn with an explicit matrix so EXIF-rotated photos go in unchanged and turned here
      const name = page.node.newXObject('Image', (await resources.image(image)).ref);
      const [a, b, c, d, e, f] = uprightImageMatrix(image.turn, layout);
      page.pushOperators(pushGraphicsState(), concatTransformationMatrix(a, b, c, d, e, f), drawObject(name), popGraphicsState());
      page.setRotation(degrees(item.rotation));
      box = { x: 0, y: 0, width: layout.pageWidth, height: layout.pageHeight };
    }

    for (const overlay of item.overlays) {
      await drawOverlay(page, overlay, box, resources);
    }
  }

  return out.save();
}
