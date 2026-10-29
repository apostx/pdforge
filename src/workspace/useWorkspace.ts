import type { PDFDocument } from 'pdf-lib';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { downloadBlob } from '../lib/download';
import type { ExportProgress } from '../pdf/exportPdf';
import { prepareSourceImage, sourceThumb, UnsupportedImageError } from '../pdf/images';
import type { Thumb } from '../pdf/thumbs';
import { addRotation } from './geometry';
import { initialState, reachable, reducer } from './state';
import type { AppError, ErrorKind, PageItem, Source } from './types';

export type { Action as WorkspaceAction } from './state';

// pdf-lib and pdf.js are large; they load with the first PDF instead of with the page,
// which keeps start-up quick on slow machines.
const loadPdfLib = () => import('pdf-lib');
const loadRenderer = () => import('../pdf/render');

class LoadFailure extends Error {
  constructor(readonly kind: ErrorKind) {
    super(kind);
  }
}

async function isPdf(file: File): Promise<boolean> {
  // the spec allows junk before the header, so look a little way in (without reading the whole file)
  const head = new TextDecoder('latin1').decode(await file.slice(0, 1024).arrayBuffer());
  return head.includes('%PDF-');
}

function baseName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '') || 'document';
}

/** Runs `work` when the browser is idle (or soon, where idle callbacks aren't supported). */
function whenIdle(work: () => void): () => void {
  if ('requestIdleCallback' in window) {
    const handle = requestIdleCallback(work, { timeout: 5000 });
    return () => cancelIdleCallback(handle);
  }
  const handle = setTimeout(work, 1000);
  return () => clearTimeout(handle);
}

export function useWorkspace() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const { doc, thumbs } = state;
  const [loadingCount, setLoadingCount] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [errors, setErrors] = useState<AppError[]>([]);

  // Free thumbnails and placed images once undo can no longer bring them back. Done when
  // the browser is idle rather than on every change, so dragging stays smooth.
  const latest = useRef(state);
  latest.current = state;
  const ownedUrls = useRef(new Set<string>());
  useEffect(() => {
    return whenIdle(() => {
      const current = latest.current;
      const { pageIds, urls } = reachable(current);
      const forgotten: string[] = [];
      for (const [id, thumb] of current.thumbs) {
        if (pageIds.has(id)) urls.add(thumb.url);
        else {
          URL.revokeObjectURL(thumb.url);
          forgotten.push(id);
        }
      }
      for (const url of ownedUrls.current) if (!urls.has(url)) URL.revokeObjectURL(url);
      ownedUrls.current = urls;
      if (forgotten.length > 0) dispatch({ type: 'forgetThumbs', ids: forgotten });
    });
  }, [state.past, state.future, doc, thumbs]);

  // PDF thumbnails: render whatever the current pages are missing, one document at a time
  // (also after undo brings back pages whose rendering had been abandoned).
  const thumbQueue = useRef(Promise.resolve());
  const requested = useRef(new Set<string>());
  const currentPageIds = useRef(new Set<string>());
  currentPageIds.current = new Set(doc.pages.map((page) => page.id));

  useEffect(() => {
    const missing = new Map<Extract<Source, { kind: 'pdf' }>, PageItem[]>();
    const sourcesById = new Map(doc.sources.map((source) => [source.id, source]));
    for (const page of doc.pages) {
      if (thumbs.has(page.id) || requested.current.has(page.id)) continue;
      const source = sourcesById.get(page.sourceId);
      if (source?.kind !== 'pdf') continue;
      missing.set(source, [...(missing.get(source) ?? []), page]);
    }

    for (const [source, pages] of missing) {
      for (const page of pages) requested.current.add(page.id);
      const delivered = new Set<string>();
      thumbQueue.current = thumbQueue.current
        .then(async () =>
          (await loadRenderer()).renderPdfThumbs(
            source.bytes,
            pages.map((page) => page.pageIndex),
            (index, thumb: Thumb) => {
              delivered.add(pages[index].id);
              dispatch({ type: 'thumb', id: pages[index].id, thumb });
            },
            () => !pages.some((page) => currentPageIds.current.has(page.id)),
          ),
        )
        .catch((error) => console.error(`Could not render previews for ${source.name}`, error))
        .finally(() => {
          // pages skipped because they were removed meanwhile can be asked for again
          for (const page of pages) if (!delivered.has(page.id)) requested.current.delete(page.id);
        });
    }
  }, [doc, thumbs]);

  const reportError = useCallback((kind: ErrorKind, fileName: string) => {
    setErrors((current) => [...current, { id: crypto.randomUUID(), kind, fileName }]);
  }, []);

  const loadFile = useCallback(async (file: File) => {
    const sourceId = crypto.randomUUID();

    if (await isPdf(file)) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const { PDFDocument } = await loadPdfLib();
      let pdf: PDFDocument;
      try {
        pdf = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
      } catch {
        throw new LoadFailure('unreadable');
      }
      if (pdf.isEncrypted) throw new LoadFailure('encrypted');

      const boxes = pdf.getPages().map((page) => {
        const { width, height } = page.getCropBox();
        return { width, height, rotation: addRotation(page.getRotation().angle, 0) };
      });
      const pages: PageItem[] = boxes.map((_, pageIndex) => ({ id: crypto.randomUUID(), sourceId, pageIndex, rotation: 0, overlays: [] }));
      dispatch({ type: 'add', source: { kind: 'pdf', id: sourceId, name: file.name, bytes, doc: pdf, boxes }, pages });
      return;
    }

    try {
      // only a reference to the file is kept; it is read again when exporting
      const image = await prepareSourceImage(file);
      const thumb = await sourceThumb(image);
      const page: PageItem = { id: crypto.randomUUID(), sourceId, pageIndex: 0, rotation: 0, overlays: [] };
      dispatch({ type: 'thumb', id: page.id, thumb });
      dispatch({ type: 'add', source: { kind: 'image', id: sourceId, name: file.name, image }, pages: [page] });
    } catch (error) {
      throw new LoadFailure(error instanceof UnsupportedImageError ? 'unsupported' : 'unreadable');
    }
  }, []);

  const addFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setLoadingCount((count) => count + files.length);
      // one by one, so pages appear in the order the files were picked
      for (const file of files) {
        try {
          await loadFile(file);
        } catch (error) {
          reportError(error instanceof LoadFailure ? error.kind : 'unreadable', file.name);
        } finally {
          setLoadingCount((count) => count - 1);
        }
      }
    },
    [loadFile, reportError],
  );

  const download = useCallback(
    async (pages: PageItem[], fileName: string) => {
      setExporting(true);
      try {
        const { exportPdf } = await import('../pdf/exportPdf');
        const pdf = await exportPdf(pages, doc.sources, state.imagePageSize, state.compression, setProgress);
        downloadBlob(pdf, fileName.toLowerCase().endsWith('.pdf') ? fileName : `${fileName}.pdf`);
      } catch (error) {
        console.error('Export failed', error);
        reportError('export', '');
      } finally {
        setExporting(false);
        setProgress(null);
      }
    },
    [doc.sources, state.imagePageSize, state.compression, reportError],
  );

  const dismissError = useCallback((id: string) => {
    setErrors((current) => current.filter((error) => error.id !== id));
  }, []);

  return {
    sources: doc.sources,
    pages: doc.pages,
    thumbs,
    selected: state.selected,
    imagePageSize: state.imagePageSize,
    compression: state.compression,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    loadingCount,
    exporting,
    progress,
    errors,
    suggestedFileName: doc.sources.length > 0 ? baseName(doc.sources[0].name) : 'document',
    addFiles,
    download,
    reportError,
    dismissError,
    dispatch,
  };
}

export type Workspace = ReturnType<typeof useWorkspace>;
