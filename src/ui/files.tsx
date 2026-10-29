import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { Icon } from './Icon';

// HEIC is listed so iPhone photos can be picked; only browsers that decode it (Safari) will load them.
const ACCEPT = 'application/pdf,.pdf,image/*,.heic,.heif';

export function AddFilesButton({ onFiles, primary = false }: { onFiles: (files: File[]) => void; primary?: boolean }) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);

  return (
    <>
      <button type="button" className={primary ? 'button button--primary' : 'button'} onClick={() => input.current?.click()}>
        <Icon name="plus" />
        {t.addFiles}
      </button>
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        multiple
        hidden
        onChange={(event) => {
          onFiles([...(event.target.files ?? [])]);
          // allow picking the same file again
          event.target.value = '';
        }}
      />
    </>
  );
}

/** Accepts files dropped anywhere on the window; returns whether files are being dragged over it. */
export function useFileDrop(onFiles: (files: File[]) => void): boolean {
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    // dragenter/dragleave fire for every child element, so count them
    let depth = 0;
    const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false;

    const onEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth++;
      setDragging(true);
    };
    const onLeave = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onOver = (event: DragEvent) => {
      if (hasFiles(event)) event.preventDefault();
    };
    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth = 0;
      setDragging(false);
      onFiles([...(event.dataTransfer?.files ?? [])]);
    };

    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('dragover', onOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [onFiles]);

  return dragging;
}

export function EmptyState({ onFiles }: { onFiles: (files: File[]) => void }) {
  const { t } = useI18n();
  return (
    <section className="empty-state">
      <span className="empty-state__icon">
        <Icon name="file" size={40} />
      </span>
      <h2>{t.dropTitle}</h2>
      <p>{t.dropHint}</p>
      <AddFilesButton onFiles={onFiles} primary />
      <p className="empty-state__privacy">{t.privacyNote}</p>
    </section>
  );
}
