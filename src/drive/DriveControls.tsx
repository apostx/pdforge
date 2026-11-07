import { useState } from 'react';
import { useI18n } from '../i18n';
import { Dialog } from '../ui/Dialog';
import { Icon } from '../ui/Icon';
import type { Workspace } from '../workspace/useWorkspace';
import { driveEnabled } from './config';
import { preloadGoogle } from './google';

/** Opens Google's picker; hidden in builds without Google Drive set up. */
export function OpenFromDriveButton({ ws, primary = false }: { ws: Workspace; primary?: boolean }) {
  const { t, lang } = useI18n();
  if (!driveEnabled) return null;
  return (
    <button
      type="button"
      className={primary ? 'button button--primary' : 'button'}
      title={t.openFromDriveHint}
      // Google's scripts start loading before the click, so the sign-in window it opens isn't blocked
      onPointerEnter={preloadGoogle}
      onFocus={preloadGoogle}
      onClick={() => void ws.openFromDrive(lang)}
    >
      <Icon name="cloud" />
      <span className="button__label">{t.openFromDrive}</span>
    </button>
  );
}

function pdfName(name: string) {
  return name.toLowerCase().endsWith('.pdf') ? name : `${name}.pdf`;
}

/** "Save to Google Drive", and its dialog: over the file the work came from (or was saved to), or as a new file. */
export function SaveToDriveButton({ ws, fileName, editable, disabled }: { ws: Workspace; fileName: string; editable: boolean; disabled: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  if (!driveEnabled) return null;
  return (
    <>
      <button
        type="button"
        className="button"
        disabled={disabled}
        onPointerEnter={preloadGoogle}
        onFocus={preloadGoogle}
        onClick={() => setOpen(true)}
      >
        <Icon name="cloudUpload" />
        {t.saveToDrive}
      </button>
      {open && <SaveToDriveDialog ws={ws} fileName={fileName} editable={editable} onClose={() => setOpen(false)} />}
    </>
  );
}

function SaveToDriveDialog({ ws, fileName, editable, onClose }: { ws: Workspace; fileName: string; editable: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const target = ws.driveTarget;
  const [replace, setReplace] = useState(target !== null);
  const [name, setName] = useState(pdfName(fileName));

  const save = async () => {
    const saved = await ws.saveToDrive(ws.pages, replace && target ? target.name : name.trim() || pdfName(fileName), editable, replace ? target : null);
    if (saved) onClose();
  };

  return (
    <Dialog title={t.saveToDrive} onClose={onClose}>
      <form
        className="drive-save"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        {target && (
          <label className="radio">
            <input type="radio" name="drive-target" checked={replace} onChange={() => setReplace(true)} />
            {t.driveReplace(target.name)}
          </label>
        )}
        <label className="radio">
          <input type="radio" name="drive-target" checked={!replace} onChange={() => setReplace(false)} />
          {t.driveNewFile}
        </label>
        <label className="field field--block">
          <span className="field__label">{t.fileName}</span>
          <input type="text" value={name} disabled={replace} onChange={(event) => setName(event.target.value)} spellCheck={false} />
        </label>
        <p className="muted">{editable ? t.driveSaveEditable : t.driveSavePlain}</p>
        <div className="dialog__actions">
          <button type="button" className="button button--quiet" onClick={onClose}>
            {t.cancel}
          </button>
          <button type="submit" className="button button--primary" disabled={ws.exporting}>
            <Icon name="cloudUpload" />
            {ws.exporting ? t.driveSaving : t.save}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
