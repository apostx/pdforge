import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../i18n';
import { imageObjectUrl } from '../pdf/images';
import { PageSurface } from '../page/PageSurface';
import { Dialog } from '../ui/Dialog';
import { Icon } from '../ui/Icon';
import { pageGeometry } from '../workspace/geometry';
import type { Workspace } from '../workspace/useWorkspace';
import {
  builtInPresets,
  placeSignature,
  presetPositions,
  targetPages,
  type PlacementPreset,
  type PresetPages,
  type PresetPosition,
} from './presets';
import { groupSignatures, variantAt } from './groups';
import { SignatureChooser } from './SignatureChooser';
import { useSignatures, type Signature } from './SignatureProvider';

type Settings = Omit<PlacementPreset, 'id' | 'name'>;

const pageOptions: PresetPages[] = ['last', 'first', 'all', 'selected'];

function settingsOf({ pages, position, widthMm, marginMm }: PlacementPreset): Settings {
  return { pages, position, widthMm, marginMm };
}

export function PlaceSignatureDialog({ ws, onClose, onManage }: { ws: Workspace; onClose: () => void; onManage: () => void }) {
  const { t } = useI18n();
  const library = useSignatures();
  const [groupName, setGroupName] = useState<string | null>(null);
  const [excludedVariants, setExcludedVariants] = useState<ReadonlySet<string>>(new Set());
  const [presetId, setPresetId] = useState<string | null>(builtInPresets[0].id);
  const [settings, setSettings] = useState<Settings>(() => settingsOf(builtInPresets[0]));
  const [presetName, setPresetName] = useState('');

  const groups = groupSignatures(library.signatures);
  const group = groups.find((candidate) => candidate.name === groupName) ?? groups[0];
  useEffect(() => setExcludedVariants(new Set()), [group?.name]);
  const variants = group ? group.variants.filter((variant) => !excludedVariants.has(variant.id)) : [];
  // where the turn of variants starts, so a document doesn't always open with the same one
  const offset = useMemo(() => Math.floor(Math.random() * 1000), [group?.name]);
  const variantFor = (index: number) => variantAt(variants, offset, index);
  const presets = [...builtInPresets, ...library.presets];
  const targets = targetPages(ws.pages, ws.selected, settings.pages);
  const sourceOf = (sourceId: string) => ws.sources.find((source) => source.id === sourceId)!;

  const previewPage = targets[0];
  const previewGeometry = previewPage && pageGeometry(previewPage, sourceOf(previewPage.sourceId), ws.imagePageSize);
  const previewOverlays =
    previewPage && variants.length > 0
      ? [...previewPage.overlays, placeSignature(variantFor(0), previewGeometry!, settings, variantFor(0).url)]
      : (previewPage?.overlays ?? []);

  const change = (patch: Partial<Settings>) => {
    setSettings((current) => ({ ...current, ...patch }));
    setPresetId(null);
  };

  const presetLabel = (preset: PlacementPreset) =>
    preset.name || t.presetNames[preset.id as keyof typeof t.presetNames] || preset.id;

  const place = () => {
    if (variants.length === 0) return;
    // one URL per variant, shared by its copies; the workspace frees it once the last copy is gone
    const urls = new Map<Signature, string>();
    const urlOf = (variant: Signature) => {
      if (!urls.has(variant)) urls.set(variant, imageObjectUrl(variant.image));
      return urls.get(variant)!;
    };
    ws.dispatch({
      type: 'addOverlays',
      items: targets.map((page, index) => {
        const variant = variantFor(index);
        return {
          pageId: page.id,
          overlay: placeSignature(variant, pageGeometry(page, sourceOf(page.sourceId), ws.imagePageSize), settings, urlOf(variant)),
        };
      }),
    });
    onClose();
  };

  return (
    <Dialog title={t.placeSignature} onClose={onClose} wide>
      <div className="place-dialog">
        <div className="place-dialog__form">
          <SignatureChooser value={group} onChange={setGroupName} onManage={onManage} />

          {group && group.variants.length > 1 && (
            <fieldset className="variant-picker">
              <legend className="field__label">{t.variantsToUse}</legend>
              {group.variants.map((variant, index) => (
                <label key={variant.id} className="variant-choice">
                  <input
                    type="checkbox"
                    checked={!excludedVariants.has(variant.id)}
                    aria-label={t.useVariant(index + 1)}
                    onChange={() =>
                      setExcludedVariants((current) => {
                        const next = new Set(current);
                        if (next.has(variant.id)) next.delete(variant.id);
                        else next.add(variant.id);
                        return next;
                      })
                    }
                  />
                  <span className="signature-tile doc-surface">
                    <img src={variant.url} alt="" />
                  </span>
                </label>
              ))}
            </fieldset>
          )}

          <fieldset className="preset-chips">
            <legend className="field__label">{t.presets}</legend>
            {presets.map((preset) => (
              <span key={preset.id} className="preset-chip">
                <button
                  type="button"
                  aria-pressed={presetId === preset.id}
                  onClick={() => {
                    setSettings(settingsOf(preset));
                    setPresetId(preset.id);
                  }}
                >
                  {presetLabel(preset)}
                </button>
                {!preset.id.startsWith('builtin-') && (
                  <button
                    type="button"
                    className="preset-chip__delete"
                    title={t.deletePreset}
                    aria-label={`${t.deletePreset}: ${preset.name}`}
                    onClick={() => library.deletePreset(preset.id)}
                  >
                    <Icon name="close" size={14} />
                  </button>
                )}
              </span>
            ))}
          </fieldset>

          <div className="form-row">
            <label className="field">
              <span className="field__label">{t.pagesLabel}</span>
              <select value={settings.pages} onChange={(event) => change({ pages: event.target.value as PresetPages })}>
                {pageOptions.map((option) => (
                  <option key={option} value={option}>
                    {t.pagesOptions[option]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field__label">{t.positionLabel}</span>
              <select value={settings.position} onChange={(event) => change({ position: event.target.value as PresetPosition })}>
                {presetPositions.map((position) => (
                  <option key={position} value={position}>
                    {t.positions[position]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="form-row">
            <label className="field field--narrow">
              <span className="field__label">{t.widthMm}</span>
              <input
                type="number"
                min={5}
                max={200}
                value={settings.widthMm}
                onChange={(event) => event.target.valueAsNumber > 0 && change({ widthMm: event.target.valueAsNumber })}
              />
            </label>
            <label className="field field--narrow">
              <span className="field__label">{t.marginMm}</span>
              <input
                type="number"
                min={0}
                max={100}
                value={settings.marginMm}
                onChange={(event) => event.target.valueAsNumber >= 0 && change({ marginMm: event.target.valueAsNumber })}
              />
            </label>
          </div>

          {presetId === null && (
            <form
              className="form-row"
              onSubmit={(event) => {
                event.preventDefault();
                const preset = { id: crypto.randomUUID(), name: presetName.trim(), ...settings };
                void library.savePreset(preset);
                setPresetId(preset.id);
                setPresetName('');
              }}
            >
              <label className="field field--grow">
                <span className="field__label">{t.savePresetAs}</span>
                <input type="text" value={presetName} placeholder={t.presetName} onChange={(event) => setPresetName(event.target.value)} />
              </label>
              <button type="submit" className="button" disabled={!presetName.trim() || library.status !== 'ready'}>
                {t.save}
              </button>
            </form>
          )}
        </div>

        <div className="place-dialog__preview">
          <span className="field__label">{t.preview}</span>
          <div className="placement-preview">
            <div className="placement-preview__frame">
              {previewPage && previewGeometry && ws.thumbs.has(previewPage.id) ? (
                <PageSurface geometry={previewGeometry} backgroundUrl={ws.thumbs.get(previewPage.id)!.url} overlays={previewOverlays} />
              ) : (
                <p className="muted">{t.noTargetPages}</p>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="dialog__actions">
        <button type="button" className="button button--quiet" onClick={onClose}>
          {t.cancel}
        </button>
        <button type="button" className="button button--primary" disabled={variants.length === 0 || targets.length === 0} onClick={place}>
          <Icon name="signature" />
          {t.placeOn(targets.length)}
        </button>
      </div>
    </Dialog>
  );
}
