import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useI18n } from '../i18n';
import { layoutText, loadFont } from '../pdf/fonts';
import { imageObjectUrl, prepareOverlayImage } from '../pdf/images';
import { closeEditorDocument, renderPdfPage } from '../pdf/render';
import { overlaySize, PageSurface, useTextLayout } from '../page/PageSurface';
import { groupSignatures, nextVariant } from '../signatures/groups';
import { centredSignature } from '../signatures/presets';
import { SignatureChooser } from '../signatures/SignatureChooser';
import { useSignatures } from '../signatures/SignatureProvider';
import { Dialog } from '../ui/Dialog';
import { Icon } from '../ui/Icon';
import { useElementSize } from '../ui/useElementSize';
import { centredAnchor, pageGeometry, rotateVec, type PageGeometry, type Vec } from '../workspace/geometry';
import type { Overlay, PageItem, Source } from '../workspace/types';
import type { Workspace } from '../workspace/useWorkspace';
import { OverlayPanel } from './OverlayPanel';

/** Space kept around the page inside the canvas, in CSS pixels. */
const CANVAS_PADDING = 24;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Pixel size of the unrotated page so that, once rotated, it fits the available area. */
function fitPage(geometry: PageGeometry, available: { width: number; height: number }) {
  const quarterTurn = geometry.rotation % 180 !== 0;
  const shownWidth = quarterTurn ? geometry.height : geometry.width;
  const shownHeight = quarterTurn ? geometry.width : geometry.height;
  const scale = Math.max(
    0.05,
    Math.min((available.width - 2 * CANVAS_PADDING) / shownWidth, (available.height - 2 * CANVAS_PADDING) / shownHeight),
  );
  return { width: geometry.width * scale, height: geometry.height * scale, scale };
}

/** A sharp rendering of the page for its on-screen size, falling back to the thumbnail meanwhile. */
function useEditorBackground(page: PageItem, source: Source, longSidePx: number, thumbUrl: string | undefined): string | undefined {
  const [url, setUrl] = useState<string>();
  // re-render only when the size changes noticeably; images don't need re-rendering at all.
  // 0 means the canvas hasn't been measured yet.
  const bucket = source.kind === 'pdf' ? Math.min(4096, Math.ceil(longSidePx / 512) * 512) : Math.sign(longSidePx);

  useEffect(() => {
    if (bucket === 0) return;
    let cancelled = false;
    let created: string | undefined;
    const rendering =
      source.kind === 'pdf'
        ? renderPdfPage(source.bytes, page.pageIndex, bucket)
        : Promise.resolve(imageObjectUrl(source.image));
    rendering.then(
      (next) => {
        if (cancelled) URL.revokeObjectURL(next);
        else {
          created = next;
          setUrl(next);
        }
      },
      // closing the editor or changing page mid-render cancels it; only real failures are reported
      (error) => !cancelled && console.error('Could not render page', error),
    );
    return () => {
      cancelled = true;
      setUrl(undefined);
      if (created) URL.revokeObjectURL(created);
    };
  }, [source, page.pageIndex, bucket]);

  return url ?? thumbUrl;
}

interface Drag {
  mode: 'move' | 'resize';
  pointerId: number;
  startX: number;
  startY: number;
  overlay: Overlay;
  /** Overlay size in points when the drag started. */
  box: { width: number; height: number };
}

interface EditorViewProps {
  ws: Workspace;
  page: PageItem;
  source: Source;
  position: number;
  onOpenPage: (id: string) => void;
  onClose: () => void;
  onManageSignatures: () => void;
}

function EditorView({ ws, page, source, position, onOpenPage, onClose, onManageSignatures }: EditorViewProps) {
  const { t } = useI18n();
  const signatures = useSignatures();
  const [choosingSignature, setChoosingSignature] = useState(false);
  const [signatureName, setSignatureName] = useState<string | null>(null);
  const signatureGroups = groupSignatures(signatures.signatures);
  const chosenGroup = signatureGroups.find((group) => group.name === signatureName) ?? signatureGroups[0];
  const hintId = useId();
  const geometry = useMemo(() => pageGeometry(page, source, ws.imagePageSize), [page, source, ws.imagePageSize]);
  const rotation = geometry.rotation;

  const canvas = useRef<HTMLDivElement>(null);
  const available = useElementSize(canvas);
  const fitted = fitPage(geometry, available);
  const ready = available.width > 0;
  const background = useEditorBackground(
    page,
    source,
    ready ? Math.max(fitted.width, fitted.height) * Math.min(window.devicePixelRatio || 1, 2) : 0,
    ws.thumbs.get(page.id)?.url,
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [justAddedText, setJustAddedText] = useState<string | null>(null);
  const selected = page.overlays.find((overlay) => overlay.id === selectedId) ?? null;
  const selectedLayout = useTextLayout(selected?.kind === 'text' ? selected : null);
  const selectedBox = selected && overlaySize(selected, selectedLayout);

  const overlayElements = useRef(new Map<string, HTMLDivElement>());
  // A newly added image or box takes the focus within the same render, so a key pressed
  // right afterwards (Escape, arrows) already applies to it, even on a slow machine.
  const [focusRequest, setFocusRequest] = useState<string | null>(null);
  useLayoutEffect(() => {
    if (!focusRequest) return;
    overlayElements.current.get(focusRequest)?.focus();
    setFocusRequest(null);
  }, [focusRequest]);
  const drag = useRef<Drag | null>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const backButton = useRef<HTMLButtonElement>(null);

  useEffect(() => backButton.current?.focus(), []);

  // Escape first drops the selection, then closes the editor. Listened for on the window,
  // because clicking the empty canvas leaves focus on <body>.
  // read through a ref, so a key pressed right after a change never sees a stale selection
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      // an open dialog handles its own Escape
      if (event.key !== 'Escape' || document.querySelector('dialog[open]')) return;
      if (selectedIdRef.current) {
        setSelectedId(null);
        (document.activeElement as HTMLElement | null)?.blur();
      } else onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const update = (overlay: Overlay) => ws.dispatch({ type: 'updateOverlay', pageId: page.id, overlay });
  const remove = (overlayId: string) => {
    ws.dispatch({ type: 'removeOverlay', pageId: page.id, overlayId });
    setSelectedId(null);
  };
  const add = (overlay: Overlay) => {
    ws.dispatch({ type: 'addOverlay', pageId: page.id, overlay });
    setSelectedId(overlay.id);
    if (overlay.kind === 'text') setJustAddedText(overlay.id);
    else setFocusRequest(overlay.id);
  };

  // New items are placed in the middle of the page, upright as the page is currently shown.
  const addText = async () => {
    const style = { family: 'sans' as const, bold: false };
    const { font } = await loadFont(style);
    const size = 14;
    const text = t.defaultText;
    const layout = layoutText(font, text, size);
    const anchor = centredAnchor(geometry, layout.width, layout.height, rotation);
    add({ id: crypto.randomUUID(), kind: 'text', ...anchor, rotation, text, ...style, size, color: '#000000' });
  };

  const addCover = () => {
    const width = 160;
    const height = 40;
    const anchor = centredAnchor(geometry, width, height, rotation);
    add({ id: crypto.randomUUID(), kind: 'rect', ...anchor, rotation, width, height, color: '#ffffff' });
  };

  const addImage = async (file: File) => {
    let image;
    try {
      image = await prepareOverlayImage(file);
    } catch {
      ws.reportError('unsupported', file.name);
      return;
    }
    const quarterTurn = rotation % 180 !== 0;
    const shownWidth = quarterTurn ? geometry.height : geometry.width;
    const shownHeight = quarterTurn ? geometry.width : geometry.height;
    // at most 40% of the page, and never blown up past one pixel per point
    const scale = Math.min((0.4 * shownWidth) / image.width, (0.4 * shownHeight) / image.height, 1);
    const width = image.width * scale;
    const height = image.height * scale;
    const anchor = centredAnchor(geometry, width, height, rotation);
    add({ id: crypto.randomUUID(), kind: 'image', ...anchor, rotation, image, url: imageObjectUrl(image), width, height });
  };

  const startDrag = (event: PointerEvent<HTMLElement>, overlay: Overlay, mode: Drag['mode']) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const box = overlay.id === selected?.id ? selectedBox : overlay.kind === 'text' ? null : overlay;
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectedId(overlay.id);
    overlayElements.current.get(overlay.id)?.focus({ preventScroll: true });
    drag.current = {
      mode,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      overlay,
      box: box ?? { width: 0, height: 0 },
    };
  };

  const moveDrag = (event: PointerEvent<HTMLElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const { overlay, box } = current;
    // screen pixels -> the page's own (unrotated) frame, in points
    const delta = rotateVec({ x: event.clientX - current.startX, y: event.clientY - current.startY }, -rotation);
    const dx = delta.x / fitted.scale;
    const dy = delta.y / fitted.scale;

    if (current.mode === 'move') {
      update({ ...overlay, x: clamp(overlay.x + dx / geometry.width, 0, 1), y: clamp(overlay.y + dy / geometry.height, 0, 1) });
      return;
    }

    // resizing works in the overlay's own frame, where the handle is the bottom-right corner
    const local = rotateVec({ x: dx, y: dy }, overlay.rotation);
    // growth along the diagonal, for resizes that keep the proportions
    const factor = 1 + (local.x * box.width + local.y * box.height) / (box.width ** 2 + box.height ** 2 || 1);
    switch (overlay.kind) {
      case 'rect':
        update({ ...overlay, width: Math.max(4, box.width + local.x), height: Math.max(4, box.height + local.y) });
        break;
      case 'image': {
        const scale = Math.max(8 / Math.min(box.width, box.height), factor);
        update({ ...overlay, width: box.width * scale, height: box.height * scale });
        break;
      }
      case 'text':
        update({ ...overlay, size: clamp(Math.round(overlay.size * factor * 2) / 2, 4, 300) });
        break;
    }
  };

  const endDrag = (event: PointerEvent<HTMLElement>) => {
    if (drag.current?.pointerId === event.pointerId) drag.current = null;
  };

  const nudge = (event: KeyboardEvent<HTMLDivElement>, overlay: Overlay) => {
    const arrows: Record<string, Vec> = {
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
      ArrowUp: { x: 0, y: -1 },
      ArrowDown: { x: 0, y: 1 },
    };
    const arrow = arrows[event.key];
    if (arrow) {
      event.preventDefault();
      const step = event.shiftKey ? 10 : 1; // points
      const delta = rotateVec(arrow, -rotation);
      update({
        ...overlay,
        x: clamp(overlay.x + (delta.x * step) / geometry.width, 0, 1),
        y: clamp(overlay.y + (delta.y * step) / geometry.height, 0, 1),
      });
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      remove(overlay.id);
    }
  };

  const describe = (overlay: Overlay) =>
    overlay.kind === 'text' ? t.overlayText(overlay.text) : overlay.kind === 'image' ? t.overlayImage : t.overlayRect;

  const total = ws.pages.length;
  const previous = ws.pages[position - 2];
  const next = ws.pages[position];

  return (
    <section className="editor" aria-label={t.editPage}>
      <div className="editor__bar">
        <div className="editor__start">
          <button ref={backButton} type="button" className="button button--quiet" onClick={onClose}>
            <Icon name="arrowLeft" />
            {t.backToPages}
          </button>
          <div className="editor__history" role="group">
            <button
              type="button"
              className="icon-button"
              disabled={!ws.canUndo}
              onClick={() => ws.dispatch({ type: 'undo' })}
              title={t.undo}
              aria-label={t.undo}
            >
              <Icon name="undo" />
            </button>
            <button
              type="button"
              className="icon-button"
              disabled={!ws.canRedo}
              onClick={() => ws.dispatch({ type: 'redo' })}
              title={t.redo}
              aria-label={t.redo}
            >
              <Icon name="redo" />
            </button>
          </div>
        </div>

        <div className="editor__pager">
          <button
            type="button"
            className="icon-button"
            disabled={!previous}
            onClick={() => previous && onOpenPage(previous.id)}
            title={t.previousPage}
            aria-label={t.previousPage}
          >
            <Icon name="chevronLeft" />
          </button>
          <span aria-live="polite">{t.pageOf(position, total)}</span>
          <button
            type="button"
            className="icon-button"
            disabled={!next}
            onClick={() => next && onOpenPage(next.id)}
            title={t.nextPage}
            aria-label={t.nextPage}
          >
            <Icon name="chevronRight" />
          </button>
        </div>

        <div className="editor__tools" role="group" aria-label={t.editorTools}>
          <button type="button" className="button" onClick={addText}>
            <Icon name="text" />
            {t.addText}
          </button>
          <button type="button" className="button" onClick={() => imageInput.current?.click()}>
            <Icon name="image" />
            {t.addImage}
          </button>
          <input
            ref={imageInput}
            type="file"
            accept="image/*,.heic,.heif"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void addImage(file);
            }}
          />
          <button type="button" className="button" onClick={addCover} title={t.addCoverHint}>
            <Icon name="box" />
            {t.addCover}
          </button>
          <button type="button" className="button" onClick={() => setChoosingSignature(true)}>
            <Icon name="signature" />
            {t.addSignature}
          </button>
        </div>
      </div>

      <div className="editor__body">
        {/* overlays stop their pointerdown, so this only fires on the page or the empty canvas */}
        <div ref={canvas} className="editor__canvas" onPointerDown={() => setSelectedId(null)}>
          {ready && (
            <PageSurface
              geometry={geometry}
              backgroundUrl={background}
              overlays={page.overlays}
              size={fitted}
              overlayProps={(overlay) => ({
                className: overlay.id === selectedId ? 'overlay--editable overlay--selected' : 'overlay--editable',
                ref: (element: HTMLDivElement | null) => {
                  if (element) overlayElements.current.set(overlay.id, element);
                  else overlayElements.current.delete(overlay.id);
                },
                tabIndex: 0,
                role: 'button',
                'aria-label': describe(overlay),
                'aria-describedby': hintId,
                onFocus: () => setSelectedId(overlay.id),
                onKeyDown: (event) => nudge(event, overlay),
                onPointerDown: (event) => startDrag(event, overlay, 'move'),
                onPointerMove: moveDrag,
                onPointerUp: endDrag,
                onPointerCancel: endDrag,
                children: overlay.id === selectedId && selectedBox && (
                  <span
                    className="overlay__handle"
                    aria-hidden="true"
                    onPointerDown={(event) => startDrag(event, overlay, 'resize')}
                    onPointerMove={moveDrag}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                  />
                ),
              })}
            />
          )}
        </div>

        <aside className="editor__panel">
          {selected ? (
            <OverlayPanel
              key={selected.id}
              overlay={selected}
              focusText={justAddedText === selected.id}
              onChange={update}
              onDelete={() => remove(selected.id)}
            />
          ) : (
            <p className="editor__empty">{t.noSelection}</p>
          )}
          <p id={hintId} className="editor__hint">
            {t.editorHint}
          </p>
        </aside>
      </div>

      {choosingSignature && (
        <Dialog title={t.placeSignature} onClose={() => setChoosingSignature(false)}>
          <SignatureChooser
            value={chosenGroup}
            onChange={setSignatureName}
            onManage={() => {
              setChoosingSignature(false);
              onManageSignatures();
            }}
          />
          <div className="dialog__actions">
            <button type="button" className="button button--quiet" onClick={() => setChoosingSignature(false)}>
              {t.cancel}
            </button>
            <button
              type="button"
              className="button button--primary"
              disabled={!chosenGroup || signatures.status !== 'ready'}
              onClick={() => {
                // each placement takes the next variant, so two signatures on a page differ
                const variant = nextVariant(chosenGroup!);
                add(centredSignature(variant, geometry, imageObjectUrl(variant.image)));
                setChoosingSignature(false);
              }}
            >
              {t.placeSignature}
            </button>
          </div>
        </Dialog>
      )}
    </section>
  );
}

interface PageEditorProps {
  ws: Workspace;
  pageId: string;
  onOpenPage: (id: string) => void;
  onClose: () => void;
  onManageSignatures: () => void;
}

export function PageEditor({ ws, pageId, onOpenPage, onClose, onManageSignatures }: PageEditorProps) {
  const index = ws.pages.findIndex((page) => page.id === pageId);
  const page = ws.pages[index];
  const source = page && ws.sources.find((candidate) => candidate.id === page.sourceId);

  useEffect(() => {
    if (!page) onClose();
  }, [page, onClose]);

  // the page list behind the editor shouldn't scroll
  useEffect(() => {
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
      closeEditorDocument();
    };
  }, []);

  if (!page || !source) return null;
  return (
    <EditorView
      key={page.id}
      ws={ws}
      page={page}
      source={source}
      position={index + 1}
      onOpenPage={onOpenPage}
      onClose={onClose}
      onManageSignatures={onManageSignatures}
    />
  );
}
