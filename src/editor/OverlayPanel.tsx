import { useEffect, useRef } from 'react';
import { useI18n } from '../i18n';
import type { FontFamily } from '../pdf/fonts';
import { Icon } from '../ui/Icon';
import type { Overlay } from '../workspace/types';

interface OverlayPanelProps {
  overlay: Overlay;
  /** Focus and select the text field (right after adding a text). */
  focusText: boolean;
  onChange: (overlay: Overlay) => void;
  onDelete: () => void;
}

export function OverlayPanel({ overlay, focusText, onChange, onDelete }: OverlayPanelProps) {
  const { t } = useI18n();
  const textField = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (focusText) {
      textField.current?.focus();
      textField.current?.select();
    }
  }, [focusText, overlay.id]);

  return (
    <div className="overlay-panel">
      {overlay.kind === 'text' && (
        <>
          <label className="field field--block">
            <span className="field__label">{t.textContent}</span>
            <textarea
              ref={textField}
              rows={3}
              value={overlay.text}
              onChange={(event) => onChange({ ...overlay, text: event.target.value })}
            />
          </label>
          <div className="overlay-panel__row">
            <label className="field">
              <span className="field__label">{t.font}</span>
              <select
                value={overlay.family}
                onChange={(event) => onChange({ ...overlay, family: event.target.value as FontFamily })}
              >
                <option value="sans">{t.fontSans}</option>
                <option value="serif">{t.fontSerif}</option>
              </select>
            </label>
            <label className="field field--narrow">
              <span className="field__label">{t.fontSize}</span>
              <input
                type="number"
                min={4}
                max={300}
                step={0.5}
                value={overlay.size}
                onChange={(event) => {
                  const size = event.target.valueAsNumber;
                  if (size >= 4 && size <= 300) onChange({ ...overlay, size });
                }}
              />
            </label>
          </div>
          <div className="overlay-panel__row">
            <label className="checkbox">
              <input type="checkbox" checked={overlay.bold} onChange={(event) => onChange({ ...overlay, bold: event.target.checked })} />
              {t.bold}
            </label>
            <label className="field field--inline">
              <span className="field__label">{t.color}</span>
              <input type="color" value={overlay.color} onChange={(event) => onChange({ ...overlay, color: event.target.value })} />
            </label>
          </div>
        </>
      )}

      {overlay.kind === 'rect' && (
        <label className="field field--inline">
          <span className="field__label">{t.color}</span>
          <input type="color" value={overlay.color} onChange={(event) => onChange({ ...overlay, color: event.target.value })} />
        </label>
      )}

      <button type="button" className="button button--danger" onClick={onDelete}>
        <Icon name="trash" />
        {t.deleteItem}
      </button>
    </div>
  );
}
