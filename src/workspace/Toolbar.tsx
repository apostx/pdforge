import { useState } from 'react';
import { useI18n } from '../i18n';
import { readSetting, writeSetting } from '../lib/storage';
import { OpenFromDriveButton, SaveToDriveButton } from '../drive/DriveControls';
import { AddFilesButton } from '../ui/files';
import { Icon, type IconName } from '../ui/Icon';
import type { Compression, ImagePageSize } from './types';
import type { Workspace } from './useWorkspace';

function ToolButton({ icon, label, onClick, disabled, danger }: {
  icon: IconName;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button type="button" className={danger ? 'button button--danger' : 'button'} onClick={onClick} disabled={disabled} title={label}>
      <Icon name={icon} />
      <span className="button__label">{label}</span>
    </button>
  );
}

const EDITABLE_SETTING = 'pdforge.editable';

export function Toolbar({ ws, onPlaceSignature }: { ws: Workspace; onPlaceSignature: () => void }) {
  const { t } = useI18n();
  const [fileName, setFileName] = useState('');
  const [editable, setEditable] = useState(() => readSetting(EDITABLE_SETTING) !== '0');

  const selectedPages = ws.pages.filter((page) => ws.selected.has(page.id));
  const selectedIds = selectedPages.map((page) => page.id);
  const hasSelection = selectedIds.length > 0;
  const allSelected = hasSelection && selectedIds.length === ws.pages.length;
  const hasImages = ws.sources.some((source) => source.kind === 'image');
  const exportBlocked = ws.exporting || ws.loadingCount > 0 || ws.pages.length === 0;
  const outputName = fileName.trim() || ws.suggestedFileName;

  return (
    <div className="toolbar">
      <div className="toolbar__row">
        <div className="toolbar__group">
          <AddFilesButton onFiles={ws.addFiles} />
          <OpenFromDriveButton ws={ws} />
          <ToolButton icon="signature" label={t.placeSignature} disabled={ws.pages.length === 0} onClick={onPlaceSignature} />
          <ToolButton icon="undo" label={t.undo} disabled={!ws.canUndo} onClick={() => ws.dispatch({ type: 'undo' })} />
          <ToolButton icon="redo" label={t.redo} disabled={!ws.canRedo} onClick={() => ws.dispatch({ type: 'redo' })} />
        </div>
        <div className="toolbar__group">
          <p className="toolbar__status" aria-live="polite">
            {t.pageCount(ws.pages.length)}
            {hasSelection && ` · ${t.selectedCount(selectedIds.length)}`}
            {ws.loadingCount > 0 && ` · ${t.loadingFiles(ws.loadingCount)}`}
          </p>
          <KeepWork ws={ws} />
        </div>
      </div>

      <div className="toolbar__row">
        <div className="toolbar__group">
          {!allSelected && (
            <button type="button" className="button button--quiet" onClick={() => ws.dispatch({ type: 'selectAll' })}>
              {t.selectAll}
            </button>
          )}
          {hasSelection && (
            <button type="button" className="button button--quiet" onClick={() => ws.dispatch({ type: 'clearSelection' })}>
              {t.clearSelection}
            </button>
          )}
          <ToolButton
            icon="rotateLeft"
            label={t.rotateLeft}
            disabled={!hasSelection}
            onClick={() => ws.dispatch({ type: 'rotate', ids: selectedIds, delta: -90 })}
          />
          <ToolButton
            icon="rotateRight"
            label={t.rotateRight}
            disabled={!hasSelection}
            onClick={() => ws.dispatch({ type: 'rotate', ids: selectedIds, delta: 90 })}
          />
          <ToolButton
            icon="trash"
            label={t.remove}
            disabled={!hasSelection}
            danger
            onClick={() => ws.dispatch({ type: 'remove', ids: selectedIds })}
          />
          <button
            type="button"
            className="button button--quiet"
            onClick={() => window.confirm(t.confirmRemoveAll) && ws.dispatch({ type: 'clear' })}
          >
            {t.removeAll}
          </button>
        </div>

        <div className="toolbar__group toolbar__export">
          {hasImages && (
            <label className="field">
              <span className="field__label">{t.imagePages}</span>
              <select
                value={ws.imagePageSize}
                onChange={(event) => ws.dispatch({ type: 'imagePageSize', value: event.target.value as ImagePageSize })}
              >
                <option value="a4">{t.imageSizeA4}</option>
                <option value="fit">{t.imageSizeFit}</option>
              </select>
            </label>
          )}
          {ws.pages.length > 0 && (
            <label className="field" title={t.compressionHint}>
              <span className="field__label">{t.compression}</span>
              <select
                value={ws.compression}
                onChange={(event) => ws.dispatch({ type: 'compression', value: event.target.value as Compression })}
              >
                <option value="none">{t.compressionNone}</option>
                <option value="high">{t.compressionHigh}</option>
                <option value="medium">{t.compressionMedium}</option>
                <option value="small">{t.compressionSmall}</option>
              </select>
            </label>
          )}
          <label className="checkbox" title={t.editableHint}>
            <input
              type="checkbox"
              checked={editable}
              onChange={(event) => {
                setEditable(event.target.checked);
                writeSetting(EDITABLE_SETTING, event.target.checked ? '1' : '0');
              }}
            />
            {t.editable}
          </label>
          <label className="field">
            <span className="field__label">{t.fileName}</span>
            <input
              type="text"
              value={fileName}
              placeholder={ws.suggestedFileName}
              onChange={(event) => setFileName(event.target.value)}
              spellCheck={false}
            />
          </label>
          {hasSelection && !allSelected && (
            <button
              type="button"
              className="button"
              disabled={exportBlocked}
              onClick={() => ws.download(selectedPages, outputName, editable)}
            >
              <Icon name="download" />
              {t.downloadSelected(selectedIds.length)}
            </button>
          )}
          <SaveToDriveButton ws={ws} fileName={outputName} editable={editable} disabled={exportBlocked} />
          <button
            type="button"
            className="button button--primary"
            disabled={exportBlocked}
            onClick={() => ws.download(ws.pages, outputName, editable)}
          >
            <Icon name="download" />
            {!ws.exporting
              ? t.downloadAll
              : ws.progress?.stage === 'compressing'
                ? t.compressing(ws.progress.done + 1, ws.progress.total)
                : t.creatingPdf}
          </button>
        </div>
      </div>
    </div>
  );
}

/** The "keep after reload" switch, and whether the work is kept right now. */
function KeepWork({ ws }: { ws: Workspace }) {
  const { t } = useI18n();
  const status = ws.sessionStatus;
  const note =
    status === 'otherTab'
      ? t.sessionOtherTab
      : status === 'unavailable'
        ? t.sessionUnavailable
        : status === 'failed'
          ? t.sessionFailed
          : status === 'saving' || status === 'restoring'
            ? t.sessionSaving
            : status === 'saved'
              ? t.sessionSaved
              : null;
  return (
    <div className="keep-work">
      <label className="checkbox" title={t.keepWorkHint}>
        <input
          type="checkbox"
          checked={ws.keepWork && status !== 'otherTab' && status !== 'unavailable'}
          disabled={status === 'otherTab' || status === 'unavailable'}
          onChange={(event) => ws.setKeepWork(event.target.checked)}
        />
        {t.keepWork}
      </label>
      {note && (
        <span className={status === 'failed' || status === 'otherTab' || status === 'unavailable' ? 'keep-work__note keep-work__note--warning' : 'keep-work__note'} role="status">
          {note}
        </span>
      )}
    </div>
  );
}
