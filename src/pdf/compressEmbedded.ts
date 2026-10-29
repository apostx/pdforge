import { PDFArray, PDFBool, PDFDict, PDFName, PDFNumber, PDFRawStream, PDFRef, type PDFDocument, type PDFPage } from 'pdf-lib';
import { compressImage, type CompressSource } from './compress';

// Recompresses the pictures inside PDF pages (scans above all), which is where most of a
// PDF's size usually is. Only images that can be handled safely are touched: JPEG and
// 8-bit grey/RGB Flate data without masks or unusual colour handling. Everything else
// (CMYK, indexed colours, JPEG 2000, fax-style black and white…) is left exactly as it was.

export interface EmbeddedCompression {
  dpi: number;
  quality: number;
  onProgress: (done: number, total: number) => void;
}

/** Smaller images aren't worth the time. */
const MIN_BYTES = 30 * 1024;

interface Candidate {
  ref: PDFRef;
  stream: PDFRawStream;
  /** Longest side, in points, of the largest page showing the image. */
  pageSide: number;
}

const name = (value: string) => PDFName.of(value);

const REPLACED_KEYS = new Set(['Filter', 'DecodeParms', 'Width', 'Height', 'ColorSpace', 'BitsPerComponent', 'Length', 'Decode', 'DL'].map(name));

function findImages(doc: PDFDocument, pages: PDFPage[]): Candidate[] {
  const found = new Map<string, Candidate>();
  const visitedForms = new Set<string>();

  const visit = (resources: PDFDict | undefined, side: number) => {
    const xobjects = resources?.lookupMaybe(name('XObject'), PDFDict);
    if (!xobjects) return;
    for (const [, value] of xobjects.entries()) {
      if (!(value instanceof PDFRef)) continue;
      const object = doc.context.lookup(value);
      if (!(object instanceof PDFRawStream)) continue;
      const key = value.toString();
      const subtype = object.dict.get(name('Subtype'));
      if (subtype === name('Image')) {
        if ((found.get(key)?.pageSide ?? 0) < side) found.set(key, { ref: value, stream: object, pageSide: side });
      } else if (subtype === name('Form') && !visitedForms.has(`${key}@${side}`)) {
        visitedForms.add(`${key}@${side}`);
        visit(object.dict.lookupMaybe(name('Resources'), PDFDict), side);
      }
    }
  };

  for (const page of pages) {
    const { width, height } = page.getSize();
    visit(page.node.Resources(), Math.max(width, height));
  }
  return [...found.values()];
}

function numberIn(dict: PDFDict | undefined, key: string, fallback: number): number {
  const value = dict?.lookup(name(key));
  return value instanceof PDFNumber ? value.asNumber() : fallback;
}

/** 1 for grey, 3 for RGB, null for colour spaces we leave alone. */
function colorComponents(doc: PDFDocument, value: unknown): 1 | 3 | null {
  const space = value instanceof PDFRef ? doc.context.lookup(value) : value;
  if (space === name('DeviceGray')) return 1;
  if (space === name('DeviceRGB')) return 3;
  if (space instanceof PDFArray) {
    const family = space.get(0);
    if (family === name('CalGray')) return 1;
    if (family === name('CalRGB')) return 3;
    if (family === name('ICCBased')) {
      const profile = space.lookup(1);
      const components = profile instanceof PDFRawStream ? numberIn(profile.dict, 'N', 0) : 0;
      return components === 1 || components === 3 ? components : null;
    }
  }
  return null;
}

function onlyFilter(dict: PDFDict): unknown {
  const filter = dict.lookup(name('Filter'));
  if (filter instanceof PDFArray) return filter.size() === 1 ? filter.lookup(0) : undefined;
  return filter;
}

function decodeParams(dict: PDFDict): PDFDict | undefined {
  let params = dict.lookup(name('DecodeParms'));
  if (params instanceof PDFArray) params = params.lookup(0);
  return params instanceof PDFDict ? params : undefined;
}

/**
 * PDF viewers ignore EXIF orientation in embedded JPEGs but the browser's decoder applies it,
 * so drop any EXIF segment before decoding.
 */
function withoutExif(jpeg: Uint8Array): Uint8Array {
  const view = new DataView(jpeg.buffer, jpeg.byteOffset, jpeg.byteLength);
  let offset = 2;
  while (offset + 4 <= jpeg.length) {
    const marker = view.getUint16(offset);
    if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) break;
    const length = view.getUint16(offset + 2);
    if (marker === 0xffe1 && offset + 8 <= jpeg.length && view.getUint32(offset + 4) === 0x45786966) {
      const out = new Uint8Array(jpeg.length - (length + 2));
      out.set(jpeg.subarray(0, offset));
      out.set(jpeg.subarray(offset + 2 + length), offset);
      return out;
    }
    offset += 2 + length;
  }
  return jpeg;
}

function sourceOf(doc: PDFDocument, dict: PDFDict, contents: Uint8Array, width: number, height: number): CompressSource | null {
  // stencil masks, colour-key masks and remapped colours would not survive a JPEG round trip
  if (dict.lookup(name('ImageMask')) === PDFBool.True || dict.has(name('Mask')) || dict.has(name('Decode'))) return null;
  const components = colorComponents(doc, dict.lookup(name('ColorSpace')));
  if (!components) return null;

  const filter = onlyFilter(dict);
  if (filter === name('DCTDecode')) {
    return { kind: 'encoded', blob: new Blob([withoutExif(contents) as BlobPart], { type: 'image/jpeg' }) };
  }
  if (filter === name('FlateDecode') && numberIn(dict, 'BitsPerComponent', 0) === 8) {
    const params = decodeParams(dict);
    const predictor = numberIn(params, 'Predictor', 1);
    const pngRows =
      predictor >= 10 &&
      numberIn(params, 'Colors', 1) === components &&
      numberIn(params, 'Columns', 1) === width &&
      numberIn(params, 'BitsPerComponent', 8) === 8;
    if (predictor !== 1 && !pngRows) return null;
    return { kind: 'raw', data: contents, width, height, components, predictor };
  }
  return null;
}

async function compressOne(doc: PDFDocument, { ref, stream, pageSide }: Candidate, dpi: number, quality: number) {
  const { dict, contents } = stream;
  const width = numberIn(dict, 'Width', 0);
  const height = numberIn(dict, 'Height', 0);
  if (!width || !height) return;
  const source = sourceOf(doc, dict, contents, width, height);
  if (!source) return;

  // An image can't usefully be sharper than the page it is on at the chosen resolution.
  const scale = Math.min(1, ((pageSide / 72) * dpi) / Math.max(width, height));
  const newWidth = Math.max(1, Math.round(width * scale));
  const newHeight = Math.max(1, Math.round(height * scale));
  const blob = await compressImage(source, newWidth, newHeight, quality, false);
  if (blob.size >= contents.length * 0.9) return; // keep the original unless it clearly pays off

  const replacement = doc.context.obj({});
  for (const [key, value] of dict.entries()) {
    if (!REPLACED_KEYS.has(key)) replacement.set(key, value);
  }
  replacement.set(name('Type'), name('XObject'));
  replacement.set(name('Subtype'), name('Image'));
  replacement.set(name('Width'), PDFNumber.of(newWidth));
  replacement.set(name('Height'), PDFNumber.of(newHeight));
  replacement.set(name('ColorSpace'), name('DeviceRGB'));
  replacement.set(name('BitsPerComponent'), PDFNumber.of(8));
  replacement.set(name('Filter'), name('DCTDecode'));
  doc.context.assign(ref, PDFRawStream.of(replacement, new Uint8Array(await blob.arrayBuffer())));
}

/** Recompresses the images used by `pages` (already copied into `doc`), one at a time. */
export async function compressEmbeddedImages(doc: PDFDocument, pages: PDFPage[], { dpi, quality, onProgress }: EmbeddedCompression) {
  const candidates = findImages(doc, pages).filter((candidate) => candidate.stream.contents.length >= MIN_BYTES);
  for (const [index, candidate] of candidates.entries()) {
    onProgress(index, candidates.length);
    try {
      await compressOne(doc, candidate, dpi, quality);
    } catch (error) {
      // one odd image shouldn't stop the export; it simply stays as it was
      console.warn('Image left uncompressed', error);
    }
  }
}
