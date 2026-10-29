import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { useI18n } from './i18n';
import { EmptyState, useFileDrop } from './ui/files';
import { Header } from './ui/Header';
import { Icon } from './ui/Icon';
import { Notices } from './ui/Notices';
import { PageGrid } from './workspace/PageGrid';
import { Toolbar } from './workspace/Toolbar';
import { useWorkspace } from './workspace/useWorkspace';

// Loaded when first opened, to keep start-up light.
const PageEditor = lazy(() => import('./editor/PageEditor').then((module) => ({ default: module.PageEditor })));
const SignatureManager = lazy(() => import('./signatures/SignatureManager').then((module) => ({ default: module.SignatureManager })));
const PlaceSignatureDialog = lazy(() =>
  import('./signatures/PlaceSignatureDialog').then((module) => ({ default: module.PlaceSignatureDialog })),
);

type OpenDialog = 'signatures' | 'place' | null;

// File Handling API (installed apps); not in the standard DOM typings yet.
interface LaunchQueue {
  setConsumer: (consumer: (params: { files: FileSystemFileHandle[] }) => void) => void;
}

/** Fields where Ctrl+Z should stay the browser's own text undo. */
function isTextField(element: EventTarget | null): boolean {
  if (!(element instanceof HTMLElement)) return false;
  if (element.isContentEditable || element.tagName === 'TEXTAREA') return true;
  return element instanceof HTMLInputElement && ['text', 'number', 'password', 'search', 'email', 'url'].includes(element.type);
}

export function App() {
  const { t } = useI18n();
  const ws = useWorkspace();
  const draggingFiles = useFileDrop(ws.addFiles);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<OpenDialog>(null);
  const closeEditor = useCallback(() => setEditingId(null), []);
  const closeDialog = useCallback(() => setDialog(null), []);
  const empty = ws.pages.length === 0 && ws.loadingCount === 0;
  const { dispatch } = ws;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || isTextField(event.target)) return;
      if (document.querySelector('dialog[open]')) return;
      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        dispatch({ type: 'undo' });
      } else if ((key === 'z' && event.shiftKey) || key === 'y') {
        event.preventDefault();
        dispatch({ type: 'redo' });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dispatch]);

  // Installed as an app, PDFs and pictures can be opened with PDForge from the file manager.
  const { addFiles } = ws;
  useEffect(() => {
    const launchQueue = (window as { launchQueue?: LaunchQueue }).launchQueue;
    launchQueue?.setConsumer(async ({ files }) => addFiles(await Promise.all(files.map((handle) => handle.getFile()))));
  }, [addFiles]);

  return (
    <>
      <Header onOpenSignatures={() => setDialog('signatures')} />
      <main className="workspace">
        {empty ? (
          <EmptyState onFiles={ws.addFiles} />
        ) : (
          <>
            <Toolbar ws={ws} onPlaceSignature={() => setDialog('place')} />
            <PageGrid ws={ws} onEdit={setEditingId} />
          </>
        )}
      </main>
      <Suspense fallback={null}>
        {editingId && (
          <PageEditor
            ws={ws}
            pageId={editingId}
            onOpenPage={setEditingId}
            onClose={closeEditor}
            onManageSignatures={() => setDialog('signatures')}
          />
        )}
        {dialog === 'signatures' && <SignatureManager onClose={closeDialog} />}
        {dialog === 'place' && <PlaceSignatureDialog ws={ws} onClose={closeDialog} onManage={() => setDialog('signatures')} />}
      </Suspense>
      {draggingFiles && !editingId && (
        <div className="drop-overlay" aria-hidden="true">
          <Icon name="file" size={48} />
          <p>{t.dropOverlay}</p>
        </div>
      )}
      <Notices errors={ws.errors} onDismiss={ws.dismissError} />
    </>
  );
}
