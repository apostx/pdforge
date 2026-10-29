import { useState } from 'react';
import { useI18n } from '../i18n';
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

export function Toolbar({ ws, onPlaceSignature }: { ws: Workspace; onPlaceSignature: () => void }) {
  const { t } = useI18n();
  const [fileName, setFileName] = useState('');

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
          <ToolButton icon="signature" label={t.placeSignature} disabled={ws.pages.length === 0} onClick={onPlaceSignature} />
          <ToolButton icon="undo" label={t.undo} disabled={!ws.canUndo} onClick={() => ws.dispatch({ type: 'undo' })} />
          <ToolButton icon="redo" label={t.redo} disabled={!ws.canRedo} onClick={() => ws.dispatch({ type: 'redo' })} />
        </div>
        <p className="toolbar__status" aria-live="polite">
          {t.pageCount(ws.pages.length)}
          {hasSelection && ` · ${t.selectedCount(selectedIds.length)}`}
          {ws.loadingCount > 0 && ` · ${t.loadingFiles(ws.loadingCount)}`}
        </p>
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
              onClick={() => ws.download(selectedPages, outputName)}
            >
              <Icon name="download" />
              {t.downloadSelected(selectedIds.length)}
            </button>
          )}
          <button
            type="button"
            className="button button--primary"
            disabled={exportBlocked}
            onClick={() => ws.download(ws.pages, outputName)}
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
