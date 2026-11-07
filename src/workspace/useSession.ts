import { useCallback, useEffect, useRef, useState, type Dispatch } from 'react';
import { imageObjectUrl, sourceThumb, type SourceImage } from '../pdf/images';
import { readSetting, writeSetting } from '../lib/storage';
import { parseImageInfo, restoredImage, restoreOverlay } from './serialize';
import { claimSession, clearSession, describe, imageFileKey, loadSession, saveSession, sourceFileKey, type Session } from './session';
import type { Action } from './state';
import type { Compression, ImagePageSize, Overlay, PageItem, Source } from './types';
import type { OpenedPdf } from './useWorkspace';
import type { DriveRef } from '../drive/config';

/**
 * Whether the workspace is kept for after a reload:
 * - restoring: reading back what was kept
 * - saved / saving / failed: kept (or not, storage refused it)
 * - off: turned off
 * - otherTab: another tab is keeping its work, so this one doesn't
 * - unavailable: this browser offers no storage here (a private window, say)
 */
export type SessionStatus = 'restoring' | 'saved' | 'saving' | 'failed' | 'off' | 'otherTab' | 'unavailable';

const SETTING = 'pdforge.keepWork';
/**
 * Changes are saved at most this long after they happen; changes meanwhile (the steps of a
 * drag, say) go into the same save. Not reset by each change, so steady work is still saved.
 * (Saving only when leaving the page isn't enough: browsers may cut off storage writes then.)
 */
const SAVE_DELAY = 500;

/** A Drive file reference read back from storage, or nothing if it doesn't look like one. */
function driveRef(value: unknown): DriveRef | undefined {
  const ref = value as Partial<DriveRef> | null | undefined;
  if (!ref || typeof ref.id !== 'string' || typeof ref.name !== 'string') return undefined;
  return { id: ref.id, name: ref.name, ...(typeof ref.folder === 'string' ? { folder: ref.folder } : {}) };
}

async function rebuild(session: Session, openPdf: OpenedPdf, dispatch: Dispatch<Action>) {
  const { state, files } = session;
  const sources: Source[] = [];
  const pageCounts = new Map<string, number>();
  const imageSources = new Map<string, SourceImage>();
  for (const stored of state.sources) {
    const blob = files.get(sourceFileKey(stored.id));
    if (!blob) continue;
    try {
      const drive = driveRef(stored.drive);
      if (stored.kind === 'pdf') {
        const opened = await openPdf(new Uint8Array(await blob.arrayBuffer()), stored.name, stored.id);
        const source = drive ? { ...opened, drive } : opened;
        sources.push(source);
        pageCounts.set(source.id, source.boxes.length);
      } else {
        const { format, width, height, turn, components } = stored;
        const image: SourceImage = { blob, format, width, height, turn, components };
        sources.push({ kind: 'image', id: stored.id, name: stored.name, image, ...(drive ? { drive } : {}) });
        pageCounts.set(stored.id, 1);
        imageSources.set(stored.id, image);
      }
    } catch (error) {
      console.error(`Could not restore ${stored.name}`, error);
    }
  }

  const images = new Map<string, ReturnType<typeof restoredImage>>();
  for (const [key, value] of Object.entries(state.images)) {
    const info = parseImageInfo(value);
    const blob = files.get(imageFileKey(key));
    if (info && blob) images.set(key, restoredImage(key, info, new Uint8Array(await blob.arrayBuffer())));
  }
  const urls = new Map<string, string>();
  const imageFor = (key: string) => {
    const image = images.get(key);
    if (!image) return null;
    if (!urls.has(key)) urls.set(key, imageObjectUrl(image));
    return { image, url: urls.get(key)! };
  };

  const pages: PageItem[] = state.pages
    .filter((page) => (pageCounts.get(page.sourceId) ?? 0) > page.pageIndex)
    .map((page) => ({
      ...page,
      overlays: page.overlays.map((overlay) => restoreOverlay(overlay, imageFor, false)).filter((overlay): overlay is Overlay => overlay !== null),
    }));

  dispatch({ type: 'restore', sources, pages, imagePageSize: state.imagePageSize, compression: state.compression });
  // photo pages get their thumbnails from the photo; PDF pages render theirs as usual
  for (const page of pages) {
    const image = imageSources.get(page.sourceId);
    if (image) void sourceThumb(image).then((thumb) => dispatch({ type: 'thumb', id: page.id, thumb }), () => {});
  }
}

export function useSession(
  doc: { sources: Source[]; pages: PageItem[] },
  imagePageSize: ImagePageSize,
  compression: Compression,
  dispatch: Dispatch<Action>,
  openPdf: OpenedPdf,
  driveTarget: DriveRef | null,
  setDriveTarget: (target: DriveRef | null) => void,
) {
  const [keepWork, setKeepWorkState] = useState(() => readSetting(SETTING) !== '0');
  const [status, setStatus] = useState<SessionStatus>('restoring');
  const owner = useRef(false);
  const restored = useRef(false);
  const stored = useRef(new Set<string>());

  // at start: claim the session (one tab only), then bring back what was kept
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      owner.current = await claimSession();
      if (cancelled) return;
      if (!owner.current) return setStatus('otherTab');
      if (!keepWork) {
        restored.current = true;
        return setStatus('off');
      }
      try {
        const session = await loadSession();
        if (session && !cancelled) {
          await rebuild(session, openPdf, dispatch);
          setDriveTarget(driveRef(session.state.driveTarget) ?? null);
          // already in storage: the next save needn't write them again
          for (const key of session.files.keys()) stored.current.add(key);
        }
        restored.current = true;
        setStatus('saved');
      } catch (error) {
        console.error('Could not restore the previous work', error);
        restored.current = true;
        setStatus(typeof indexedDB === 'undefined' ? 'unavailable' : 'failed');
      }
    })();
    return () => {
      cancelled = true;
    };
    // once, at start
  }, []);

  // saves run one after another, each with the latest state
  const latest = useRef({ doc, imagePageSize, compression, driveTarget });
  latest.current = { doc, imagePageSize, compression, driveTarget };
  const queue = useRef(Promise.resolve());
  const pending = useRef<number | null>(null);

  const save = useCallback(() => {
    pending.current = null;
    queue.current = queue.current.then(async () => {
      const { doc: current, imagePageSize: size, compression: level, driveTarget: target } = latest.current;
      const { state, files } = describe(current.sources, current.pages, size, level, target);
      setStatus('saving');
      try {
        await saveSession(state, files, stored.current);
        setStatus('saved');
        // ask the browser not to clear our storage under pressure (granted silently or not at all)
        if (current.pages.length > 0) void navigator.storage?.persist?.();
      } catch (error) {
        console.error('Could not keep the work in this browser', error);
        stored.current.clear(); // unknown what got written: write everything next time
        setStatus('failed');
      }
    });
  }, []);

  const active = keepWork && status !== 'restoring' && status !== 'otherTab' && status !== 'off' && status !== 'unavailable';
  useEffect(() => {
    if (!active || !restored.current || pending.current !== null) return;
    pending.current = window.setTimeout(save, SAVE_DELAY);
  }, [doc, imagePageSize, compression, driveTarget, active, save]);
  useEffect(
    () => () => {
      if (pending.current !== null) window.clearTimeout(pending.current);
    },
    [],
  );

  // leaving the page (closing, reloading, switching away on a phone): save what is waiting now
  useEffect(() => {
    const flush = () => {
      if (pending.current === null) return;
      window.clearTimeout(pending.current);
      save();
    };
    const onVisibility = () => document.visibilityState === 'hidden' && flush();
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [save]);

  const setKeepWork = useCallback(
    (keep: boolean) => {
      setKeepWorkState(keep);
      writeSetting(SETTING, keep ? '1' : '0');
      if (!owner.current) return;
      if (keep) {
        restored.current = true;
        setStatus('saved'); // the effect above saves right away
      } else {
        if (pending.current !== null) window.clearTimeout(pending.current);
        pending.current = null;
        queue.current = queue.current.then(async () => {
          try {
            await clearSession();
          } catch (error) {
            console.error('Could not clear the kept work', error);
          }
          stored.current.clear();
        });
        setStatus('off');
      }
    },
    [],
  );

  return { keepWork, setKeepWork, sessionStatus: status };
}
