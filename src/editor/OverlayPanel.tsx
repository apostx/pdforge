import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { FONT_CATEGORIES, FONT_FAMILIES, type FontFamily } from '../pdf/fontCatalog';
import { hasItalic, LINE_HEIGHT, loadFont, peekFont, type FontStyle, type TextAlign } from '../pdf/fonts';
import { Icon, type IconName } from '../ui/Icon';
import type { Overlay, TextOverlay } from '../workspace/types';

const familyIds = Object.keys(FONT_FAMILIES) as FontFamily[];
const LINE_SPACINGS = [1, 1.15, LINE_HEIGHT, 1.5, 2];
const ALIGNMENTS: { value: TextAlign; icon: IconName }[] = [
  { value: 'left', icon: 'alignLeft' },
  { value: 'center', icon: 'alignCenter' },
  { value: 'right', icon: 'alignRight' },
];

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
  const { t, lang } = useI18n();
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
    const italicAvailable = hasItalic(shown.family);
    const style = (change: Partial<FontStyle>) =>
      fontSwitch.apply({ family: shown.family, bold: shown.bold, italic: shown.italic, ...change });
    const alignLabels: Record<TextAlign, string> = { left: t.alignLeft, center: t.alignCenter, right: t.alignRight };
    return (
      <>
        <label className="field field--block">
          <span className="field__label">{t.textContent}</span>
          <textarea ref={textField} rows={3} value={text.text} onChange={(event) => onChange({ ...text, text: event.target.value })} />
        </label>
        <label className="field field--block">
          <span className="field__label">{t.font}</span>
          <select className="font-select" value={shown.family} onChange={(event) => style({ family: event.target.value as FontFamily })}>
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
          <label className="field">
            <span className="field__label">{t.lineSpacing}</span>
            <select value={text.lineSpacing} onChange={(event) => onChange({ ...text, lineSpacing: Number(event.target.value) })}>
              {(LINE_SPACINGS.includes(text.lineSpacing) ? LINE_SPACINGS : [...LINE_SPACINGS, text.lineSpacing].sort((a, b) => a - b)).map((value) => (
                <option key={value} value={value}>
                  {value.toLocaleString(lang)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="overlay-panel__row">
          <div className="segmented" role="group" aria-label={t.textStyle}>
            <button type="button" className="style-toggle style-toggle--bold" aria-pressed={shown.bold} title={t.bold} aria-label={t.bold} onClick={() => style({ bold: !shown.bold })}>
              B
            </button>
            <button
              type="button"
              className="style-toggle style-toggle--italic"
              aria-pressed={shown.italic && italicAvailable}
              disabled={!italicAvailable}
              title={italicAvailable ? t.italic : t.noItalic}
              aria-label={t.italic}
              onClick={() => style({ italic: !shown.italic })}
            >
              I
            </button>
          </div>
          <div className="segmented" role="group" aria-label={t.align}>
            {ALIGNMENTS.map(({ value, icon }) => (
              <button
                key={value}
                type="button"
                aria-pressed={text.align === value}
                title={alignLabels[value]}
                aria-label={alignLabels[value]}
                onClick={() => onChange({ ...text, align: value })}
              >
                <Icon name={icon} size={16} />
              </button>
            ))}
          </div>
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
