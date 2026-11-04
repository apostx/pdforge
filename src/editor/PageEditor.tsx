import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';
import { useI18n } from '../i18n';
import { DEFAULT_FONT_FAMILY } from '../pdf/fontCatalog';
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
import type { Overlay, PageItem, Source, TextOverlay } from '../workspace/types';
import type { Workspace } from '../workspace/useWorkspace';
import { OverlayPanel } from './OverlayPanel';

/** Space kept around the page inside the canvas, in CSS pixels. */
const CANVAS_PADDING = 24;

/** CSS pixels per point at 100% (actual size): 96 dpi on screen, 72 points per inch. */
const ACTUAL_SIZE = 96 / 72;
/** Zoom steps for the buttons and keys, in percent of actual size. */
const ZOOM_STEPS = [25, 33, 50, 67, 75, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400];
/** Fixed levels offered in the zoom menu. */
const ZOOM_MENU = [50, 75, 100, 125, 150, 200, 300, 400];
const MIN_ZOOM = 25;
const MAX_ZOOM = 400;

/** How the page is sized in the editor: fitted to the canvas, or a set scale (CSS pixels per point). */
export type Zoom = { fit: 'page' | 'width' } | { scale: number };

/** How a new text looks: like the last one changed, so a form can be filled in one style. */
export type TextStyle = Pick<TextOverlay, 'family' | 'bold' | 'size' | 'color'>;

const DEFAULT_TEXT_STYLE: TextStyle = { family: DEFAULT_FONT_FAMILY, bold: false, size: 14, color: '#000000' };

/** Distance from the canvas edge, in CSS pixels, at which dragging an item scrolls the view. */
const AUTOSCROLL_EDGE = 32;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Width of a classic scrollbar (0 where scrollbars overlay the content). */
function scrollbarWidth(): number {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;top:-200px;width:100px;height:100px;overflow:scroll';
  document.body.append(probe);
  const width = probe.offsetWidth - probe.clientWidth;
  probe.remove();
  return width;
}

/** The page's size as shown (rotated), in points. */
function shownSize(geometry: PageGeometry) {
  const quarterTurn = geometry.rotation % 180 !== 0;
  return { width: quarterTurn ? geometry.height : geometry.width, height: quarterTurn ? geometry.width : geometry.height };
}

/** CSS pixels per point for each way of fitting the page into the available area. */
function fitScales(geometry: PageGeometry, available: { width: number; height: number }, scrollbar: number) {
  const shown = shownSize(geometry);
  const room = { width: available.width - 2 * CANVAS_PADDING, height: available.height - 2 * CANVAS_PADDING };
  const page = Math.max(0.05, Math.min(room.width / shown.width, room.height / shown.height));
  let width = Math.max(0.05, room.width / shown.width);
  // a page taller than the canvas brings up a vertical scrollbar, which takes some of the width
  if (shown.height * width > room.height) width = Math.max(0.05, (room.width - scrollbar) / shown.width);
  return { page, width };
}

/** A sharp rendering of the page for its on-screen size, falling back to the thumbnail meanwhile. */
function useEditorBackground(page: PageItem, source: Source, longSidePx: number, thumbUrl: string | undefined): string | undefined {
  const [rendered, setRendered] = useState<{ url: string; bucket: number } | null>(null);
  // re-render only when the size changes noticeably; images don't need re-rendering at all.
  // 0 means the canvas hasn't been measured yet.
  const bucket = source.kind === 'pdf' ? Math.min(4096, Math.ceil(longSidePx / 512) * 512) : Math.sign(longSidePx);
  const hasRendering = rendered !== null;
  const current = rendered?.bucket === bucket;

  useEffect(() => {
    if (bucket === 0 || current) return;
    let cancelled = false;
    // while zooming the size changes in quick steps: render once it settles, showing the
    // previous rendering (stretched) meanwhile
    const timer = window.setTimeout(
      () => {
        const rendering =
          source.kind === 'pdf'
            ? renderPdfPage(source.bytes, page.pageIndex, bucket)
            : Promise.resolve(imageObjectUrl(source.image));
        rendering.then(
          (url) => {
            if (cancelled) URL.revokeObjectURL(url);
            else setRendered({ url, bucket });
          },
          // closing the editor or changing page mid-render cancels it; only real failures are reported
          (error) => !cancelled && console.error('Could not render page', error),
        );
      },
      hasRendering ? 250 : 0,
    );
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [source, page.pageIndex, bucket, current, hasRendering]);

  // each rendering is released once the next one is showing, and the last one with the editor
  const url = rendered?.url;
  useEffect(() => (url ? () => URL.revokeObjectURL(url) : undefined), [url]);

  return url ?? thumbUrl;
}

interface Drag {
  mode: 'move' | 'resize';
  pointerId: number;
  /** Where the drag started, on the page as shown, in points. */
  start: Vec;
  /** The latest pointer position, for scrolling at the canvas edge. */
  client: Vec;
  overlay: Overlay;
  /** Overlay size in points when the drag started. */
  box: { width: number; height: number };
}

interface Pan {
  pointerId: number;
  x: number;
  y: number;
  left: number;
  top: number;
}

/** Anchors a zoom: the point on the page (as fractions of the page as shown) to keep at `client`. */
interface ZoomAnchor {
  fraction: Vec;
  /** Position in the scroll area's visible part, in CSS pixels. */
  client: Vec;
}

/**
 * Zooming with Ctrl + wheel (also what a touchpad pinch sends), Safari's touchpad gesture
 * events, and two-finger pinches on touch screens. Plain wheel and one-finger drags scroll.
 */
function useZoomGestures(
  scroller: RefObject<HTMLDivElement | null>,
  scaleRef: RefObject<number>,
  anchorAt: (client: Vec) => ZoomAnchor,
  zoomTo: (scale: number, anchor: ZoomAnchor) => void,
  onPinchStart: () => void,
) {
  // listeners are attached once; they reach the latest handlers through this ref
  const handlers = useRef({ anchorAt, zoomTo, onPinchStart });
  handlers.current = { anchorAt, zoomTo, onPinchStart };

  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const local = (clientX: number, clientY: number): Vec => {
      const rect = element.getBoundingClientRect();
      return { x: clientX - rect.left, y: clientY - rect.top };
    };

    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const pixels = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaMode === 2 ? event.deltaY * 400 : event.deltaY;
      const point = local(event.clientX, event.clientY);
      handlers.current.zoomTo(scaleRef.current * Math.exp(-pixels * 0.002), handlers.current.anchorAt(point));
    };

    let pinch: { distance: number; scale: number; fraction: Vec } | null = null;
    const fingers = (touches: TouchList) => {
      const [a, b] = [touches[0], touches[1]];
      return { distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1, middle: local((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2) };
    };
    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 2) return;
      const { distance, middle } = fingers(event.touches);
      pinch = { distance, scale: scaleRef.current, fraction: handlers.current.anchorAt(middle).fraction };
      handlers.current.onPinchStart();
    };
    const onTouchMove = (event: TouchEvent) => {
      if (!pinch || event.touches.length !== 2) return;
      if (event.cancelable) event.preventDefault();
      const { distance, middle } = fingers(event.touches);
      // the spot that was between the fingers stays between them, so the pinch also pans
      handlers.current.zoomTo(pinch.scale * (distance / pinch.distance), { fraction: pinch.fraction, client: middle });
    };
    const onTouchEnd = (event: TouchEvent) => {
      if (event.touches.length < 2) pinch = null;
    };

    // Safari (macOS touchpad): non-standard gesture events instead of Ctrl + wheel
    type GestureEvent = UIEvent & { scale: number; clientX: number; clientY: number };
    let gesture: { scale: number; fraction: Vec; client: Vec } | null = null;
    const onGestureStart = (event: Event) => {
      event.preventDefault();
      if (pinch) return; // touch screens send both; the touch events handle those
      const { clientX, clientY } = event as GestureEvent;
      const client = local(clientX, clientY);
      gesture = { scale: scaleRef.current, fraction: handlers.current.anchorAt(client).fraction, client };
    };
    const onGestureChange = (event: Event) => {
      event.preventDefault();
      if (!gesture || pinch) return;
      handlers.current.zoomTo(gesture.scale * (event as GestureEvent).scale, { fraction: gesture.fraction, client: gesture.client });
    };
    const onGestureEnd = () => {
      gesture = null;
    };

    const options = { passive: false };
    element.addEventListener('wheel', onWheel, options);
    element.addEventListener('touchstart', onTouchStart, options);
    element.addEventListener('touchmove', onTouchMove, options);
    element.addEventListener('touchend', onTouchEnd);
    element.addEventListener('touchcancel', onTouchEnd);
    element.addEventListener('gesturestart', onGestureStart, options);
    element.addEventListener('gesturechange', onGestureChange, options);
    element.addEventListener('gestureend', onGestureEnd);
    return () => {
      element.removeEventListener('wheel', onWheel);
      element.removeEventListener('touchstart', onTouchStart);
      element.removeEventListener('touchmove', onTouchMove);
      element.removeEventListener('touchend', onTouchEnd);
      element.removeEventListener('touchcancel', onTouchEnd);
      element.removeEventListener('gesturestart', onGestureStart);
      element.removeEventListener('gesturechange', onGestureChange);
      element.removeEventListener('gestureend', onGestureEnd);
    };
  }, [scroller, scaleRef]);
}

interface EditorViewProps {
  ws: Workspace;
  page: PageItem;
  source: Source;
  position: number;
  zoom: Zoom;
  onZoom: (zoom: Zoom) => void;
  textStyle: RefObject<TextStyle>;
  onOpenPage: (id: string) => void;
  onClose: () => void;
  onManageSignatures: () => void;
}

function EditorView({ ws, page, source, position, zoom, onZoom, textStyle, onOpenPage, onClose, onManageSignatures }: EditorViewProps) {
  const { t } = useI18n();
  const signatures = useSignatures();
  const [choosingSignature, setChoosingSignature] = useState(false);
  const [signatureName, setSignatureName] = useState<string | null>(null);
  const signatureGroups = groupSignatures(signatures.signatures);
  const chosenGroup = signatureGroups.find((group) => group.name === signatureName) ?? signatureGroups[0];
  const hintId = useId();
  const geometry = useMemo(() => pageGeometry(page, source, ws.imagePageSize), [page, source, ws.imagePageSize]);
  const rotation = geometry.rotation;
  const shown = shownSize(geometry);

  // The canvas (measured, never scrolls) holds the scroll area, which holds the stage: the page
  // plus padding, at least as big as the visible area so a small page sits in the middle.
  const canvas = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const available = useElementSize(canvas);
  const ready = available.width > 0;
  const [scrollbar] = useState(scrollbarWidth);
  const fit = fitScales(geometry, available, scrollbar);
  const minScale = Math.min((MIN_ZOOM / 100) * ACTUAL_SIZE, fit.page);
  const maxScale = (MAX_ZOOM / 100) * ACTUAL_SIZE;
  const scale = 'fit' in zoom ? fit[zoom.fit] : clamp(zoom.scale, minScale, maxScale);
  const percent = Math.round((scale / ACTUAL_SIZE) * 100);
  const pageSize = { width: geometry.width * scale, height: geometry.height * scale };
  const stageSize = { width: shown.width * scale + 2 * CANVAS_PADDING, height: shown.height * scale + 2 * CANVAS_PADDING };
  const pannable = ready && (stageSize.width > available.width + 1 || stageSize.height > available.height + 1);

  const background = useEditorBackground(
    page,
    source,
    ready ? Math.max(pageSize.width, pageSize.height) * Math.min(window.devicePixelRatio || 1, 2) : 0,
    ws.thumbs.get(page.id)?.url,
  );

  // The scale the page is laid out at. Updated right after the DOM, so pointer maths always
  // matches what is on screen; zoom steps that come faster than renders build on `targetScale`.
  const layoutScale = useRef(scale);
  const targetScale = useRef(scale);
  const pendingAnchor = useRef<ZoomAnchor | null>(null);

  /** Converts a viewport position to a point on the page as shown, in points from its top-left. */
  const pagePoint = (clientX: number, clientY: number): Vec => {
    const rect = stage.current!.getBoundingClientRect();
    const s = layoutScale.current;
    const left = rect.left + (rect.width - shown.width * s) / 2;
    const top = rect.top + (rect.height - shown.height * s) / 2;
    return { x: (clientX - left) / s, y: (clientY - top) / s };
  };

  const anchorAt = (client: Vec): ZoomAnchor => {
    const rect = scroller.current!.getBoundingClientRect();
    const point = pagePoint(rect.left + client.x, rect.top + client.y);
    return { fraction: { x: point.x / shown.width, y: point.y / shown.height }, client };
  };

  const centreAnchor = (): ZoomAnchor => {
    const element = scroller.current!;
    return anchorAt({ x: element.clientWidth / 2, y: element.clientHeight / 2 });
  };

  const setZoom = (next: Zoom, anchor: ZoomAnchor = centreAnchor()) => {
    targetScale.current = 'fit' in next ? fit[next.fit] : clamp(next.scale, minScale, maxScale);
    // no change (already at a limit): nothing to re-anchor, and no anchor left for a later resize
    pendingAnchor.current = Math.abs(targetScale.current - layoutScale.current) > 1e-9 ? anchor : null;
    onZoom(next);
  };

  const zoomToScale = (next: number, anchor?: ZoomAnchor) => setZoom({ scale: clamp(next, minScale, maxScale) }, anchor);

  const step = (direction: 1 | -1) => {
    const current = (targetScale.current / ACTUAL_SIZE) * 100;
    const next =
      direction > 0 ? (ZOOM_STEPS.find((level) => level > current + 0.5) ?? MAX_ZOOM) : ([...ZOOM_STEPS].reverse().find((level) => level < current - 0.5) ?? MIN_ZOOM);
    zoomToScale((next / 100) * ACTUAL_SIZE);
  };

  // after a zoom, scroll so the anchored point is back where it was (under the pointer, between
  // the fingers, or in the middle of the view)
  useLayoutEffect(() => {
    layoutScale.current = scale;
    targetScale.current = scale;
    const anchor = pendingAnchor.current;
    const element = scroller.current;
    if (!anchor || !element || !stage.current) return;
    pendingAnchor.current = null;
    const left = (stage.current.offsetWidth - shown.width * scale) / 2;
    const top = (stage.current.offsetHeight - shown.height * scale) / 2;
    element.scrollLeft = left + anchor.fraction.x * shown.width * scale - anchor.client.x;
    element.scrollTop = top + anchor.fraction.y * shown.height * scale - anchor.client.y;
  }, [scale, shown.width, shown.height]);

  // a page opened zoomed in starts at its top, centred across
  const placed = useRef(false);
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!ready || placed.current || !element) return;
    placed.current = true;
    element.scrollLeft = (element.scrollWidth - element.clientWidth) / 2;
  }, [ready]);

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
  const pan = useRef<Pan | null>(null);
  const [panning, setPanning] = useState(false);
  const imageInput = useRef<HTMLInputElement>(null);
  const backButton = useRef<HTMLButtonElement>(null);

  useEffect(() => backButton.current?.focus(), []);

  // Escape first drops the selection, then closes the editor. Listened for on the window,
  // because clicking the empty canvas leaves focus on <body>.
  // read through a ref, so a key pressed right after a change never sees a stale selection
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  // the zoom keys reach the latest handlers through this ref
  const zoomKeys = useRef({ step, fitPage: () => setZoom({ fit: 'page' }) });
  zoomKeys.current = { step, fitPage: () => setZoom({ fit: 'page' }) };
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      // an open dialog handles its own keys
      if (document.querySelector('dialog[open]')) return;
      if (event.key === 'Escape') {
        if (selectedIdRef.current) {
          setSelectedId(null);
          (document.activeElement as HTMLElement | null)?.blur();
        } else onClose();
        return;
      }
      // + and - zoom, 0 fits the page; not while typing, and Ctrl/Cmd + keys stay the browser's zoom
      const typing = event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]');
      if (event.ctrlKey || event.metaKey || event.altKey || typing) return;
      if (event.key === '+' || event.key === '=') zoomKeys.current.step(1);
      else if (event.key === '-' || event.key === '_') zoomKeys.current.step(-1);
      else if (event.key === '0') zoomKeys.current.fitPage();
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  useZoomGestures(scroller, targetScale, anchorAt, zoomToScale, () => {
    // a second finger turns a drag into a pinch
    drag.current = null;
    pan.current = null;
  });

  const update = (overlay: Overlay) => {
    if (overlay.kind === 'text') {
      const { family, bold, size, color } = overlay;
      textStyle.current = { family, bold, size, color };
    }
    ws.dispatch({ type: 'updateOverlay', pageId: page.id, overlay });
  };
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

  /** The middle of the part of the page in view (all of it unless zoomed in), on the page as shown. */
  const visibleCentre = (): Vec => {
    const rect = scroller.current!.getBoundingClientRect();
    const element = scroller.current!;
    return pagePoint(rect.left + element.clientWidth / 2, rect.top + element.clientHeight / 2);
  };

  // New items are placed in the middle of what is in view, upright as the page is currently shown.
  const addText = async () => {
    let style = textStyle.current;
    let font;
    try {
      ({ font } = await loadFont(style));
    } catch {
      // the remembered font can't be loaded (offline, say): the default is kept for offline use
      style = { ...style, family: DEFAULT_FONT_FAMILY };
      ({ font } = await loadFont(style));
    }
    const text = t.defaultText;
    const layout = layoutText(font, text, style.size);
    const anchor = centredAnchor(geometry, layout.width, layout.height, rotation, visibleCentre());
    add({ id: crypto.randomUUID(), kind: 'text', ...anchor, rotation, text, ...style });
  };

  const addCover = () => {
    const width = 160;
    const height = 40;
    const anchor = centredAnchor(geometry, width, height, rotation, visibleCentre());
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
    // at most 40% of the page, and never blown up past one pixel per point
    const scale = Math.min((0.4 * shown.width) / image.width, (0.4 * shown.height) / image.height, 1);
    const width = image.width * scale;
    const height = image.height * scale;
    const anchor = centredAnchor(geometry, width, height, rotation, visibleCentre());
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
      start: pagePoint(event.clientX, event.clientY),
      client: { x: event.clientX, y: event.clientY },
      overlay,
      box: box ?? { width: 0, height: 0 },
    };
    autoScroll.start();
  };

  /** Applies the current drag for the pointer at `client`, measured on the page, so scrolling and zooming meanwhile are taken into account. */
  const applyDrag = (current: Drag) => {
    const { overlay, box } = current;
    const point = pagePoint(current.client.x, current.client.y);
    // the page as shown -> the page's own (unrotated) frame, in points
    const delta = rotateVec({ x: point.x - current.start.x, y: point.y - current.start.y }, -rotation);
    const dx = delta.x;
    const dy = delta.y;

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
  const applyDragRef = useRef(applyDrag);
  applyDragRef.current = applyDrag;

  // While an item is dragged near the edge of the canvas, the view scrolls along.
  const autoScroll = useMemo(() => {
    let frame = 0;
    const tick = () => {
      const current = drag.current;
      const element = scroller.current;
      if (!current || !element) {
        frame = 0;
        return;
      }
      const rect = element.getBoundingClientRect();
      const speed = (distance: number) => (distance < AUTOSCROLL_EDGE ? Math.ceil((AUTOSCROLL_EDGE - Math.max(0, distance)) / 3) : 0);
      const { x, y } = current.client;
      const dx = speed(rect.left + element.clientWidth - x) - speed(x - rect.left);
      const dy = speed(rect.top + element.clientHeight - y) - speed(y - rect.top);
      const before = { left: element.scrollLeft, top: element.scrollTop };
      if (dx) element.scrollLeft += dx;
      if (dy) element.scrollTop += dy;
      if (element.scrollLeft !== before.left || element.scrollTop !== before.top) applyDragRef.current(current);
      frame = requestAnimationFrame(tick);
    };
    return {
      start: () => {
        if (!frame) frame = requestAnimationFrame(tick);
      },
      stop: () => {
        cancelAnimationFrame(frame);
        frame = 0;
      },
    };
  }, []);
  useEffect(() => autoScroll.stop, [autoScroll]);

  const moveDrag = (event: PointerEvent<HTMLElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    current.client = { x: event.clientX, y: event.clientY };
    applyDrag(current);
  };

  const endDrag = (event: PointerEvent<HTMLElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    autoScroll.stop();
  };

  // A mouse drag on the empty canvas or the page (not on an item) scrolls a zoomed-in page;
  // touch screens scroll natively. A click there drops the selection.
  const startPan = (event: PointerEvent<HTMLDivElement>) => {
    setSelectedId(null);
    const element = scroller.current;
    if (event.pointerType !== 'mouse' || (event.button !== 0 && event.button !== 1) || !element) return;
    if (event.button === 1) event.preventDefault(); // no autoscroll cursor
    event.currentTarget.setPointerCapture(event.pointerId);
    pan.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: element.scrollLeft, top: element.scrollTop };
  };
  const movePan = (event: PointerEvent<HTMLDivElement>) => {
    const current = pan.current;
    const element = scroller.current;
    if (!current || current.pointerId !== event.pointerId || !element) return;
    if (!panning && Math.hypot(event.clientX - current.x, event.clientY - current.y) > 3) setPanning(true);
    element.scrollLeft = current.left - (event.clientX - current.x);
    element.scrollTop = current.top - (event.clientY - current.y);
  };
  const endPan = (event: PointerEvent<HTMLDivElement>) => {
    if (pan.current?.pointerId !== event.pointerId) return;
    pan.current = null;
    setPanning(false);
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
      const stepSize = event.shiftKey ? 10 : 1; // points
      const delta = rotateVec(arrow, -rotation);
      update({
        ...overlay,
        x: clamp(overlay.x + (delta.x * stepSize) / geometry.width, 0, 1),
        y: clamp(overlay.y + (delta.y * stepSize) / geometry.height, 0, 1),
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
  const zoomValue = 'fit' in zoom ? zoom.fit : ZOOM_MENU.includes(percent) ? String(percent) : 'custom';

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

        <div className="editor__zoom" role="group" aria-label={t.zoom}>
          <button
            type="button"
            className="icon-button"
            disabled={scale <= minScale + 1e-6}
            onClick={() => step(-1)}
            title={`${t.zoomOut} (−)`}
            aria-label={t.zoomOut}
          >
            <Icon name="zoomOut" />
          </button>
          <select
            className="editor__zoom-select"
            aria-label={t.zoom}
            value={zoomValue}
            onChange={(event) => {
              const { value } = event.target;
              if (value === 'page' || value === 'width') setZoom({ fit: value });
              else if (value !== 'custom') zoomToScale((Number(value) / 100) * ACTUAL_SIZE);
            }}
          >
            <option value="page">{'fit' in zoom && zoom.fit === 'page' ? `${t.zoomFitPage} (${percent}%)` : t.zoomFitPage}</option>
            <option value="width">{'fit' in zoom && zoom.fit === 'width' ? `${t.zoomFitWidth} (${percent}%)` : t.zoomFitWidth}</option>
            {zoomValue === 'custom' && (
              <option value="custom" disabled>
                {percent}%
              </option>
            )}
            {ZOOM_MENU.map((level) => (
              <option key={level} value={level}>
                {level}%
              </option>
            ))}
          </select>
          <button
            type="button"
            className="icon-button"
            disabled={scale >= maxScale - 1e-6}
            onClick={() => step(1)}
            title={`${t.zoomIn} (+)`}
            aria-label={t.zoomIn}
          >
            <Icon name="zoomIn" />
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
        <div ref={canvas} className="editor__canvas">
          <div
            ref={scroller}
            className={['editor__scroller', pannable && 'editor__scroller--pannable', panning && 'editor__scroller--panning'].filter(Boolean).join(' ')}
          >
            {/* overlays stop their pointerdown, so this only fires on the page or the empty canvas */}
            <div
              ref={stage}
              className="editor__stage"
              style={{ width: stageSize.width, height: stageSize.height }}
              onPointerDown={startPan}
              onPointerMove={movePan}
              onPointerUp={endPan}
              onPointerCancel={endPan}
            >
              {ready && (
                <PageSurface
                  geometry={geometry}
                  backgroundUrl={background}
                  overlays={page.overlays}
                  size={pageSize}
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
          </div>
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
          <p className="editor__hint">{t.zoomHint}</p>
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
                add(centredSignature(variant, geometry, imageObjectUrl(variant.image), visibleCentre()));
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
  // kept while stepping through pages
  const [zoom, setZoom] = useState<Zoom>({ fit: 'page' });
  const textStyle = useRef<TextStyle>(DEFAULT_TEXT_STYLE);

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
      zoom={zoom}
      onZoom={setZoom}
      textStyle={textStyle}
      onOpenPage={onOpenPage}
      onClose={onClose}
      onManageSignatures={onManageSignatures}
    />
  );
}
