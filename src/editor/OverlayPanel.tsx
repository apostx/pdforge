import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { FONT_CATEGORIES, FONT_FAMILIES, type FontFamily } from '../pdf/fontCatalog';
import { loadFont, peekFont, type FontStyle } from '../pdf/fonts';
import { Icon } from '../ui/Icon';
import type { Overlay, TextOverlay } from '../workspace/types';

const familyIds = Object.keys(FONT_FAMILIES) as FontFamily[];

interface OverlayPanelProps {
  overlay: Overlay;
  /** Focus and select the text field (right after adding a text). */
  focusText: boolean;
  onChange: (overlay: Overlay) => void;
  onDelete: () => void;
}

/**
 * A font is loaded before a text switches to it, so the text keeps showing (in its old font)
 * meanwhile, and a font that can't be loaded (offline, say) never ends up on the page.
 */
function useFontSwitch(overlay: Overlay, onChange: (overlay: Overlay) => void) {
  const [pending, setPending] = useState<FontStyle | null>(null);
  const [failed, setFailed] = useState(false);
  // the text may be edited while a font loads; the switch applies to its latest state
  const latest = useRef({ overlay, onChange });
  latest.current = { overlay, onChange };
  const request = useRef(0);
  useEffect(
    () => () => {
      request.current++; // the panel closed: drop a switch still loading
    },
    [],
  );

  const apply = (style: FontStyle) => {
    const id = ++request.current;
    setFailed(false);
    const commit = () => {
      const current = latest.current.overlay;
      if (current.kind === 'text') latest.current.onChange({ ...current, ...style });
    };
    if (peekFont(style)) {
      setPending(null);
      commit();
      return;
    }
    setPending(style);
    loadFont(style).then(
      () => {
        if (id !== request.current) return;
        setPending(null);
        commit();
      },
      (error) => {
        console.error(error);
        if (id !== request.current) return;
        setPending(null);
        setFailed(true);
      },
    );
  };

  return { pending, failed, apply };
}

export function OverlayPanel({ overlay, focusText, onChange, onDelete }: OverlayPanelProps) {
  const { t } = useI18n();
  const textField = useRef<HTMLTextAreaElement>(null);
  const fontSwitch = useFontSwitch(overlay, onChange);

  useEffect(() => {
    if (focusText) {
      textField.current?.focus();
      textField.current?.select();
    }
  }, [focusText, overlay.id]);

  const fontLabel = (family: FontFamily) => {
    const { name, like } = FONT_FAMILIES[family];
    return like ? `${name} (${t.fontLike(like)})` : name;
  };

  const textControls = (text: TextOverlay) => {
    const shown = fontSwitch.pending ?? text;
    return (
      <>
        <label className="field field--block">
          <span className="field__label">{t.textContent}</span>
          <textarea ref={textField} rows={3} value={text.text} onChange={(event) => onChange({ ...text, text: event.target.value })} />
        </label>
        <label className="field field--block">
          <span className="field__label">{t.font}</span>
          <select
            value={shown.family}
            onChange={(event) => fontSwitch.apply({ family: event.target.value as FontFamily, bold: shown.bold })}
          >
            {FONT_CATEGORIES.map((category) => (
              <optgroup key={category} label={t.fontCategory[category]}>
                {familyIds
                  .filter((family) => FONT_FAMILIES[family].category === category)
                  .map((family) => (
                    <option key={family} value={family}>
                      {fontLabel(family)}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>
        {(fontSwitch.pending || fontSwitch.failed) && (
          <p className={fontSwitch.failed ? 'form-error' : 'muted'} role="status">
            {fontSwitch.failed ? t.fontLoadFailed : t.fontLoading}
          </p>
        )}
        <div className="overlay-panel__row">
          <label className="field field--narrow">
            <span className="field__label">{t.fontSize}</span>
            <input
              type="number"
              min={4}
              max={300}
              step={0.5}
              value={text.size}
              onChange={(event) => {
                const size = event.target.valueAsNumber;
                if (size >= 4 && size <= 300) onChange({ ...text, size });
              }}
            />
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={shown.bold}
              onChange={(event) => fontSwitch.apply({ family: shown.family, bold: event.target.checked })}
            />
            {t.bold}
          </label>
          <label className="field field--inline">
            <span className="field__label">{t.color}</span>
            <input type="color" value={text.color} onChange={(event) => onChange({ ...text, color: event.target.value })} />
          </label>
        </div>
      </>
    );
  };

  return (
    <div className="overlay-panel">
      {overlay.kind === 'text' && textControls(overlay)}

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
