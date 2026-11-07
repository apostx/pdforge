import type { DriveRef } from '../drive/config';
import type { PreparedImage } from '../pdf/images';
import { storeOverlays, type StoredImageInfo, type StoredOverlay } from './serialize';
import type { Compression, ImagePageSize, PageItem, Rotation, Source } from './types';

// The workspace is kept in IndexedDB on this device, so a reload or a closed tab doesn't lose
// it. Files are stored once each (a PDF's bytes, a photo's file, a placed image) and the rest,
// a small description of the pages and overlays, is rewritten after every change. Undo history
// isn't kept. A separate database from the signatures, so neither can affect the other.

const DB_NAME = 'pdforge-session';
const FILES = 'files';
const META = 'meta';
const STATE_KEY = 'state';

export type StoredSource = (
  | { kind: 'pdf'; id: string; name: string }
  | { kind: 'image'; id: string; name: string; format: 'jpg' | 'png'; width: number; height: number; turn: Rotation; components: number }
) & { drive?: DriveRef };

export interface StoredPage {
  id: string;
  sourceId: string;
  pageIndex: number;
  rotation: Rotation;
  overlays: StoredOverlay[];
}

export interface SessionState {
  version: 1;
  savedAt: number;
  sources: StoredSource[];
  pages: StoredPage[];
  images: Record<string, StoredImageInfo>;
  imagePageSize: ImagePageSize;
  compression: Compression;
  /** The Drive file the work was opened from or last saved to. */
  driveTarget?: DriveRef | null;
}

export interface Session {
  state: SessionState;
  /** File key → contents. */
  files: Map<string, Blob>;
}

export const sourceFileKey = (id: string) => `source:${id}`;
export const imageFileKey = (key: string) => `image:${key}`;

let database: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(FILES);
      request.result.createObjectStore(META);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  // a failure (private window, blocked storage) may pass; let the next call try again
  database.catch(() => (database = null));
  return database;
}

function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function committed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export async function loadSession(): Promise<Session | null> {
  const db = await openDatabase();
  const transaction = db.transaction([FILES, META]);
  const state = (await done(transaction.objectStore(META).get(STATE_KEY))) as SessionState | undefined;
  if (!state || state.version !== 1 || state.pages.length === 0) return null;
  const files = new Map<string, Blob>();
  const files$ = transaction.objectStore(FILES);
  const wanted = [...state.sources.map((source) => sourceFileKey(source.id)), ...Object.keys(state.images).map(imageFileKey)];
  for (const key of wanted) {
    const blob = (await done(files$.get(key))) as Blob | undefined;
    if (blob) files.set(key, blob);
  }
  return { state, files };
}

/** What a save writes: the description, and the files it needs. */
export function describe(
  sources: Source[],
  pages: PageItem[],
  imagePageSize: ImagePageSize,
  compression: Compression,
  driveTarget: DriveRef | null = null,
): { state: SessionState; files: Map<string, () => Blob> } {
  const images = new Map<string, PreparedImage>();
  const storedPages = pages.map((page) => ({ ...page, overlays: storeOverlays(page.overlays, images) }));
  const files = new Map<string, () => Blob>();
  const storedSources = sources.map((source): StoredSource => {
    if (source.kind === 'pdf') {
      files.set(sourceFileKey(source.id), () => new Blob([source.bytes as BlobPart], { type: 'application/pdf' }));
      return { kind: 'pdf', id: source.id, name: source.name, ...(source.drive ? { drive: source.drive } : {}) };
    }
    const { blob, format, width, height, turn, components } = source.image;
    files.set(sourceFileKey(source.id), () => blob);
    return { kind: 'image', id: source.id, name: source.name, format, width, height, turn, components, ...(source.drive ? { drive: source.drive } : {}) };
  });
  const imageInfo: Record<string, StoredImageInfo> = {};
  for (const [key, image] of images) {
    imageInfo[key] = { format: image.format, width: image.width, height: image.height };
    files.set(imageFileKey(key), () => new Blob([image.bytes as BlobPart]));
  }
  return {
    state: { version: 1, savedAt: Date.now(), sources: storedSources, pages: storedPages, images: imageInfo, imagePageSize, compression, driveTarget },
    files,
  };
}

/**
 * Writes the description, adds files not stored yet (`stored` lists those that are, and is
 * updated) and deletes files nothing refers to any more, all in one transaction.
 */
export async function saveSession(state: SessionState, files: Map<string, () => Blob>, stored: Set<string>): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction([FILES, META], 'readwrite');
  const fileStore = transaction.objectStore(FILES);
  for (const [key, blob] of files) if (!stored.has(key)) fileStore.put(blob(), key);
  transaction.objectStore(META).put(state, STATE_KEY);
  const existing = (await done(fileStore.getAllKeys())) as string[];
  for (const key of existing) if (!files.has(key)) fileStore.delete(key);
  await committed(transaction);
  stored.clear();
  for (const key of files.keys()) stored.add(key);
}

export async function clearSession(): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction([FILES, META], 'readwrite');
  transaction.objectStore(FILES).clear();
  transaction.objectStore(META).clear();
  await committed(transaction);
}

/**
 * Only one tab keeps its work: the first one open holds a lock for as long as it lives.
 * Others would overwrite (or clean away) each other's files. On a reload the page before
 * lets go of the lock a moment after the new one starts, so the lock is waited for briefly.
 * Resolves true in the tab that holds it; true too where locks aren't supported.
 */
let claim: Promise<boolean> | null = null;

export function claimSession(): Promise<boolean> {
  // one request per page, however often it is asked (React runs effects twice in development)
  claim ??= requestLock();
  return claim;
}

function requestLock(): Promise<boolean> {
  if (!navigator.locks) return Promise.resolve(true);
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 2000);
  return new Promise((resolve) => {
    navigator.locks
      .request('pdforge-session', { signal: abort.signal }, () => {
        clearTimeout(timer);
        resolve(true);
        // held until the tab closes
        return new Promise<never>(() => {});
      })
      .catch(() => resolve(false));
  });
}
