import type { Compression, ImagePageSize, PageItem, Source } from '../workspace/types';
import { compressImage, releaseCompressor } from './compress';
import { canWriteDirectly, writeJpegPdf } from './imagePdf';
import type { SourceImage } from './images';
import { imagePageLayout } from './layout';

type ImageSource = Extract<Source, { kind: 'image' }>;

/** Target resolution on the page, and JPEG quality, per compression level. */
const LEVELS: Record<Exclude<Compression, 'none'>, { dpi: number; quality: number }> = {
  high: { dpi: 200, quality: 0.85 },
  medium: { dpi: 150, quality: 0.75 },
  small: { dpi: 100, quality: 0.6 },
};

export type ExportProgress = { stage: 'compressing'; done: number; total: number } | { stage: 'writing' };

/**
 * Shrinks images to the chosen resolution for the size they are printed at, one at a time
 * in a worker. Keeps the original wherever re-encoding wouldn't make it smaller.
 */
async function compressImages(
  sources: ImageSource[],
  imagePageSize: ImagePageSize,
  compression: Exclude<Compression, 'none'>,
  onProgress: (progress: ExportProgress) => void,
): Promise<Map<ImageSource, SourceImage>> {
  const { dpi, quality } = LEVELS[compression];
  const replacements = new Map<ImageSource, SourceImage>();
  for (const [index, source] of sources.entries()) {
    onProgress({ stage: 'compressing', done: index, total: sources.length });
    const { image } = source;
    const layout = imagePageLayout(image.width, image.height, imagePageSize);
    // points are 1/72 inch; never scale up
    const scale = Math.min(1, ((layout.width / 72) * dpi) / image.width);
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const blob = await compressImage({ kind: 'encoded', blob: image.blob }, width, height, quality, image.format === 'png');
    if (blob.size < image.blob.size) {
      replacements.set(source, { blob, format: blob.type === 'image/png' ? 'png' : 'jpg', width, height, turn: 0, components: 3 });
    }
  }
  return replacements;
}

export async function exportPdf(
  pages: PageItem[],
  sources: Source[],
  imagePageSize: ImagePageSize,
  compression: Compression,
  onProgress: (progress: ExportProgress) => void,
): Promise<Blob> {
  const sourcesById = new Map(sources.map((source) => [source.id, source]));
  const used = [...new Set(pages.map((page) => sourcesById.get(page.sourceId)!))];
  const imageSources = used.filter((source): source is ImageSource => source.kind === 'image');

  try {
    return await writePdf(pages, sources, sourcesById, imageSources, imagePageSize, compression, onProgress);
  } finally {
    releaseCompressor();
  }
}

async function writePdf(
  pages: PageItem[],
  sources: Source[],
  sourcesById: Map<string, Source>,
  imageSources: ImageSource[],
  imagePageSize: ImagePageSize,
  compression: Compression,
  onProgress: (progress: ExportProgress) => void,
): Promise<Blob> {
  const replacements =
    compression === 'none' ? new Map<ImageSource, SourceImage>() : await compressImages(imageSources, imagePageSize, compression, onProgress);
  const imageFor = (source: ImageSource) => replacements.get(source) ?? source.image;
  onProgress({ stage: 'writing' });

  // Photos only, nothing placed on them: write the JPEGs straight through, without pdf-lib.
  const photosOnly = pages.every((page) => {
    const source = sourcesById.get(page.sourceId)!;
    return page.overlays.length === 0 && source.kind === 'image' && canWriteDirectly(imageFor(source));
  });
  if (photosOnly) {
    return writeJpegPdf(
      pages.map((page) => {
        const source = sourcesById.get(page.sourceId) as ImageSource;
        return {
          image: imageFor(source),
          layout: imagePageLayout(source.image.width, source.image.height, imagePageSize),
          rotation: page.rotation,
        };
      }),
      'PDForge',
    );
  }

  const { buildPdf } = await import('./buildPdf');
  const bytes = await buildPdf(pages, sources, {
    imagePageSize,
    imageFor,
    compressEmbedded:
      compression === 'none'
        ? undefined
        : { ...LEVELS[compression], onProgress: (done, total) => onProgress({ stage: 'compressing', done, total }) },
  });
  return new Blob([bytes as BlobPart], { type: 'application/pdf' });
}
