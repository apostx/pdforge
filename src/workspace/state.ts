import { arrayMove } from '@dnd-kit/sortable';
import type { Thumb } from '../pdf/thumbs';
import { addRotation } from './geometry';
import type { Compression, ImagePageSize, Overlay, PageItem, Source } from './types';

/** The part of the workspace that undo/redo covers. */
export interface Doc {
  sources: Source[];
  pages: PageItem[];
}

export interface State {
  doc: Doc;
  past: Doc[];
  future: Doc[];
  /** The last recorded change, so a run of edits to one item (dragging, typing) undoes as one step. */
  lastChange: { key: string; time: number } | null;
  /** Page id → thumbnail. Kept outside the history, so undo never loses or reuses one. */
  thumbs: ReadonlyMap<string, Thumb>;
  selected: ReadonlySet<string>;
  /** Last page clicked without Shift, the start of a Shift+click range. */
  anchor: string | null;
  imagePageSize: ImagePageSize;
  compression: Compression;
}

type DocAction =
  | { type: 'add'; source: Source; pages: PageItem[] }
  | { type: 'move'; id: string; overId: string }
  | { type: 'rotate'; ids: string[]; delta: 90 | -90 }
  | { type: 'remove'; ids: string[] }
  | { type: 'clear' }
  | { type: 'addOverlay'; pageId: string; overlay: Overlay }
  | { type: 'addOverlays'; items: { pageId: string; overlay: Overlay }[] }
  | { type: 'updateOverlay'; pageId: string; overlay: Overlay }
  | { type: 'removeOverlay'; pageId: string; overlayId: string };

export type Action =
  | DocAction
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'thumb'; id: string; thumb: Thumb }
  | { type: 'forgetThumbs'; ids: string[] }
  | { type: 'select'; id: string; range: boolean }
  | { type: 'selectAll' }
  | { type: 'clearSelection' }
  | { type: 'imagePageSize'; value: ImagePageSize }
  | { type: 'compression'; value: Compression };

const HISTORY_LIMIT = 50;
const COALESCE_MS = 1500;

export const initialState: State = {
  doc: { sources: [], pages: [] },
  past: [],
  future: [],
  lastChange: null,
  thumbs: new Map(),
  selected: new Set(),
  anchor: null,
  imagePageSize: 'a4',
  compression: 'none',
};

function updatePage(doc: Doc, id: string, update: (page: PageItem) => PageItem): Doc {
  return { ...doc, pages: doc.pages.map((page) => (page.id === id ? update(page) : page)) };
}

function docReducer(doc: Doc, action: DocAction): Doc {
  switch (action.type) {
    case 'add':
      return { sources: [...doc.sources, action.source], pages: [...doc.pages, ...action.pages] };

    case 'move': {
      const from = doc.pages.findIndex((page) => page.id === action.id);
      const to = doc.pages.findIndex((page) => page.id === action.overId);
      if (from < 0 || to < 0 || from === to) return doc;
      return { ...doc, pages: arrayMove(doc.pages, from, to) };
    }

    case 'rotate': {
      const ids = new Set(action.ids);
      if (ids.size === 0) return doc;
      return {
        ...doc,
        pages: doc.pages.map((page) => (ids.has(page.id) ? { ...page, rotation: addRotation(page.rotation, action.delta) } : page)),
      };
    }

    case 'remove': {
      const ids = new Set(action.ids);
      const pages = doc.pages.filter((page) => !ids.has(page.id));
      if (pages.length === doc.pages.length) return doc;
      const usedSources = new Set(pages.map((page) => page.sourceId));
      return { sources: doc.sources.filter((source) => usedSources.has(source.id)), pages };
    }

    case 'clear':
      return doc.pages.length === 0 ? doc : { sources: [], pages: [] };

    case 'addOverlay':
      return updatePage(doc, action.pageId, (page) => ({ ...page, overlays: [...page.overlays, action.overlay] }));

    case 'addOverlays': {
      const added = new Map<string, Overlay[]>();
      for (const { pageId, overlay } of action.items) added.set(pageId, [...(added.get(pageId) ?? []), overlay]);
      return {
        ...doc,
        pages: doc.pages.map((page) => (added.has(page.id) ? { ...page, overlays: [...page.overlays, ...added.get(page.id)!] } : page)),
      };
    }

    case 'updateOverlay':
      return updatePage(doc, action.pageId, (page) => ({
        ...page,
        overlays: page.overlays.map((overlay) => (overlay.id === action.overlay.id ? action.overlay : overlay)),
      }));

    case 'removeOverlay':
      return updatePage(doc, action.pageId, (page) => ({
        ...page,
        overlays: page.overlays.filter((overlay) => overlay.id !== action.overlayId),
      }));
  }
}

/** Drops selected ids whose pages no longer exist. */
function pruneSelection(state: State): State {
  const ids = new Set(state.doc.pages.map((page) => page.id));
  const selected = [...state.selected].filter((id) => ids.has(id));
  if (selected.length === state.selected.size && (!state.anchor || ids.has(state.anchor))) return state;
  return { ...state, selected: new Set(selected), anchor: state.anchor && ids.has(state.anchor) ? state.anchor : null };
}

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'undo': {
      const previous = state.past.at(-1);
      if (!previous) return state;
      return pruneSelection({ ...state, doc: previous, past: state.past.slice(0, -1), future: [state.doc, ...state.future], lastChange: null });
    }

    case 'redo': {
      const next = state.future[0];
      if (!next) return state;
      return pruneSelection({ ...state, doc: next, past: [...state.past, state.doc], future: state.future.slice(1), lastChange: null });
    }

    case 'thumb':
      return { ...state, thumbs: new Map(state.thumbs).set(action.id, action.thumb) };

    case 'forgetThumbs': {
      const thumbs = new Map(state.thumbs);
      for (const id of action.ids) thumbs.delete(id);
      return { ...state, thumbs };
    }

    case 'select': {
      const { pages } = state.doc;
      const selected = new Set(state.selected);
      const anchorIndex = pages.findIndex((page) => page.id === state.anchor);
      if (action.range && anchorIndex >= 0) {
        const index = pages.findIndex((page) => page.id === action.id);
        const [start, end] = anchorIndex < index ? [anchorIndex, index] : [index, anchorIndex];
        for (const page of pages.slice(start, end + 1)) selected.add(page.id);
        return { ...state, selected };
      }
      if (selected.has(action.id)) selected.delete(action.id);
      else selected.add(action.id);
      return { ...state, selected, anchor: action.id };
    }

    case 'selectAll':
      return { ...state, selected: new Set(state.doc.pages.map((page) => page.id)) };

    case 'clearSelection':
      return { ...state, selected: new Set(), anchor: null };

    case 'imagePageSize':
      return { ...state, imagePageSize: action.value };

    case 'compression':
      return { ...state, compression: action.value };

    default: {
      const doc = docReducer(state.doc, action);
      if (doc === state.doc) return state;
      const key = action.type === 'updateOverlay' ? `overlay:${action.overlay.id}` : null;
      const now = Date.now();
      const sameRun = key !== null && state.lastChange?.key === key && now - state.lastChange.time < COALESCE_MS;
      return pruneSelection({
        ...state,
        doc,
        past: sameRun ? state.past : [...state.past, state.doc].slice(-HISTORY_LIMIT),
        future: [],
        lastChange: key ? { key, time: now } : null,
      });
    }
  }
}

/** Everything undo/redo can still bring back: page ids and placed-image URLs. */
export function reachable(state: State): { pageIds: Set<string>; urls: Set<string> } {
  const pageIds = new Set<string>();
  const urls = new Set<string>();
  for (const doc of [state.doc, ...state.past, ...state.future]) {
    for (const page of doc.pages) {
      pageIds.add(page.id);
      for (const overlay of page.overlays) if (overlay.kind === 'image') urls.add(overlay.url);
    }
  }
  return { pageIds, urls };
}
