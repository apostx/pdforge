import { decodePDFRawStream, degrees, PDFArray, PDFContentStream, PDFDict, PDFName, PDFRawStream, PDFRef, PDFStream, PDFString, type PDFDocument, type PDFObject, type PDFPage } from 'pdf-lib';
import { parseImageInfo, parseRotation, restoredImage, restoreOverlay, storeOverlays, type StoredOverlay } from '../workspace/serialize';
import type { Overlay, PageItem, Rotation } from '../workspace/types';
import type { PreparedImage } from './images';

// "Editable in PDForge": an exported PDF that PDForge can open again with its texts, images and
// boxes as editable items, while every other program sees a normal PDF.
//
// Each page of the output is the original page's content plus content streams PDForge adds
// (a q/Q pair around the original, and the overlays). The document catalog's PieceInfo, the
// place the PDF spec sets aside for an application's own data, records per page which content
// streams and resources were added, the overlays themselves, and a hash of the original content.
// Opening the file again removes what was added, which brings back the original page, and turns
// the record back into overlays. Nothing else is stored: no original files, so pages removed
// before exporting aren't in the file, and the file is hardly bigger than a plain export. If
// another program has changed a page since, its hash no longer matches and the file opens as an
// ordinary PDF.

const APP = PDFName.of('PDForge');
const PIECE_INFO = PDFName.of('PieceInfo');
const RESOURCE_KINDS = ['Font', 'XObject', 'ExtGState'] as const;
type ResourceKind = (typeof RESOURCE_KINDS)[number];

interface PageRecord {
  /** Extra clockwise rotation the page had in PDForge, on top of its own. */
  rotation: Rotation;
  /** Content streams added before and after the original ones. */
  before: number;
  after: number;
  /** Resource names added for the overlays. */
  resources: Record<ResourceKind, string[]>;
  /** SHA-256 of the original content, to tell whether another program changed the page. */
  hash: string;
  overlays: StoredOverlay[];
}

interface EditsData {
  app: 'PDForge';
  version: 1;
  pages: PageRecord[];
  /** Image key → how it is stored. */
  images: Record<string, { format: 'jpg' | 'png'; width: number; height: number; name: string }>;
}

/**
 * A page's content streams, read as they are. (pdf-lib's own accessors "normalize" the page
 * first, which wraps its content in an extra q/Q pair each time a document is loaded.)
 */
function contentRefs(page: PDFPage): PDFObject[] {
  const contents = page.node.get(PDFName.of('Contents'));
  if (!contents) return [];
  const resolved = page.doc.context.lookup(contents);
  return resolved instanceof PDFArray ? resolved.asArray() : [contents];
}

const sameRef = (a: PDFObject, b: PDFObject) => a === b || (a instanceof PDFRef && b instanceof PDFRef && a.tag === b.tag);

function resourceNames(page: PDFPage): Record<ResourceKind, Set<string>> {
  const resources = page.node.Resources();
  const names = {} as Record<ResourceKind, Set<string>>;
  for (const kind of RESOURCE_KINDS) {
    const dict = resources?.lookupMaybe(PDFName.of(kind), PDFDict);
    names[kind] = new Set(dict?.keys().map((key) => key.decodeText()) ?? []);
  }
  return names;
}

async function contentHash(page: PDFPage, refs: PDFObject[]): Promise<string> {
  const parts = refs.map((ref) => {
    const stream = ref instanceof PDFRef ? page.doc.context.lookup(ref) : ref;
    if (stream instanceof PDFRawStream) {
      try {
        return decodePDFRawStream(stream).decode();
      } catch {
        return stream.contents; // a filter pdf-lib can't decode: compare the stored bytes
      }
    }
    return stream instanceof PDFContentStream ? stream.getUnencodedContents() : new Uint8Array();
  });
  const joined = new Uint8Array(parts.reduce((sum, part) => sum + part.length + 1, 0));
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length + 1; // a separator, so [ab][c] and [a][bc] differ
  }
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', joined));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Notes a page's original content before PDForge adds to it; `finish` records what was added. */
export function startPage(page: PDFPage) {
  const original = contentRefs(page);
  const resourcesBefore = resourceNames(page);
  return {
    async finish(item: PageItem, images: Map<string, PreparedImage>): Promise<PageRecord> {
      // whatever was added (by us, or by pdf-lib) sits around the original streams
      const current = contentRefs(page);
      const before = original.length === 0 ? 0 : current.findIndex((ref) => sameRef(ref, original[0]));
      const intact = before >= 0 && original.every((ref, index) => sameRef(ref, current[before + index]));
      if (!intact) throw new Error('The original content of a page was not kept together');
      const resourcesAfter = resourceNames(page);
      const resources = {} as Record<ResourceKind, string[]>;
      for (const kind of RESOURCE_KINDS) resources[kind] = [...resourcesAfter[kind]].filter((name) => !resourcesBefore[kind].has(name));
      return {
        rotation: item.rotation,
        before,
        after: current.length - before - original.length,
        resources,
        hash: await contentHash(page, original),
        overlays: storeOverlays(item.overlays, images),
      };
    },
  };
}

export function writeEdits(doc: PDFDocument, pages: PageRecord[], images: Map<string, PreparedImage>): void {
  const { context } = doc;
  const imageStreams = context.obj({});
  const imageInfo: EditsData['images'] = {};
  let count = 0;
  for (const [key, image] of images) {
    const name = `I${count++}`;
    imageStreams.set(PDFName.of(name), context.register(context.stream(image.bytes)));
    imageInfo[key] = { format: image.format, width: image.width, height: image.height, name };
  }
  const data: EditsData = { app: 'PDForge', version: 1, pages, images: imageInfo };
  const project = context.register(context.flateStream(new TextEncoder().encode(JSON.stringify(data))));
  const pieceInfo = doc.catalog.lookupMaybe(PIECE_INFO, PDFDict) ?? context.obj({});
  pieceInfo.set(APP, context.obj({ LastModified: PDFString.fromDate(new Date()), Private: context.obj({ Project: project, Images: imageStreams }) }));
  doc.catalog.set(PIECE_INFO, pieceInfo);
}

export interface Edits {
  pages: { rotation: Rotation; overlays: Overlay[] }[];
}

/** Largest project description read back, so a hostile file can't make us parse gigabytes. */
const MAX_PROJECT_BYTES = 50 * 1024 * 1024;

function rawStream(dict: PDFDict | undefined, key: string): PDFRawStream | undefined {
  const stream = dict?.lookupMaybe(PDFName.of(key), PDFStream);
  return stream instanceof PDFRawStream ? stream : undefined;
}

function streamBytes(stream: PDFRawStream): Uint8Array {
  return stream.dict.has(PDFName.of('Filter')) ? decodePDFRawStream(stream).decode() : stream.contents;
}

/**
 * Reads PDForge's edits from an opened PDF and, if they still match the pages, removes what
 * PDForge added, leaving the original pages in `doc`. Returns null for a PDF without edits, and
 * 'changed' when another program has modified it since (`doc` is then left as it is).
 */
export async function takeEdits(doc: PDFDocument, imageUrl: (image: PreparedImage) => string): Promise<Edits | 'changed' | null> {
  const pieceInfo = doc.catalog.lookupMaybe(PIECE_INFO, PDFDict);
  const ours = pieceInfo?.lookupMaybe(APP, PDFDict);
  if (!pieceInfo || !ours) return null;

  let data: EditsData;
  let privateData: PDFDict | undefined;
  try {
    privateData = ours.lookupMaybe(PDFName.of('Private'), PDFDict);
    const project = rawStream(privateData, 'Project');
    const bytes = project && streamBytes(project);
    if (!bytes || bytes.length > MAX_PROJECT_BYTES) return 'changed';
    data = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return 'changed';
  }
  const pages = doc.getPages();
  if (data?.app !== 'PDForge' || data.version !== 1 || !Array.isArray(data.pages) || data.pages.length !== pages.length) return 'changed';

  // every page must still hold exactly what PDForge wrote
  const records = data.pages;
  for (const [index, page] of pages.entries()) {
    const record = records[index];
    const refs = contentRefs(page);
    const { before, after } = record ?? {};
    if (!Number.isInteger(before) || !Number.isInteger(after) || before < 0 || after < 0 || before + after > refs.length) return 'changed';
    if ((await contentHash(page, refs.slice(before, refs.length - after))) !== record.hash) return 'changed';
  }

  // the placed images
  const images = new Map<string, { image: PreparedImage; url: string }>();
  const streams = privateData?.lookupMaybe(PDFName.of('Images'), PDFDict);
  for (const [key, value] of Object.entries(data.images ?? {})) {
    const info = parseImageInfo(value);
    const stream = typeof value?.name === 'string' ? rawStream(streams, value.name) : undefined;
    if (!info || !stream) continue;
    const image = restoredImage(key, info, streamBytes(stream));
    images.set(key, { image, url: imageUrl(image) });
  }

  // back to the original pages
  const result: Edits = { pages: [] };
  for (const [index, page] of pages.entries()) {
    const record = records[index];
    const refs = contentRefs(page);
    page.node.set(PDFName.of('Contents'), doc.context.obj(refs.slice(record.before, refs.length - record.after)));
    const resources = page.node.Resources();
    for (const kind of RESOURCE_KINDS) {
      const dict = resources?.lookupMaybe(PDFName.of(kind), PDFDict);
      for (const name of Array.isArray(record.resources?.[kind]) ? record.resources[kind] : []) {
        if (typeof name === 'string') dict?.delete(PDFName.of(name));
      }
    }
    const rotation = parseRotation(record.rotation);
    page.setRotation(degrees((((page.getRotation().angle - rotation) % 360) + 360) % 360));
    const overlays = (Array.isArray(record.overlays) ? record.overlays : [])
      .map((overlay) => restoreOverlay(overlay, (key) => images.get(key) ?? null, true))
      .filter((overlay): overlay is Overlay => overlay !== null);
    result.pages.push({ rotation, overlays });
  }
  pieceInfo.delete(APP);
  if (pieceInfo.keys().length === 0) doc.catalog.delete(PIECE_INFO);
  return result;
}
