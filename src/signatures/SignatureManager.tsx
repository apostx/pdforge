import { useDeferredValue, useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { useI18n } from '../i18n';
import { downloadBlob } from '../lib/download';
import { Dialog } from '../ui/Dialog';
import { Icon } from '../ui/Icon';
import {
  canvasToSignature,
  decodeUpload,
  INK_COLORS,
  cleanBackground,
  splitSignatures,
  strokesToSignature,
  type InkColor,
  type Stroke,
} from './imaging';
import { groupSignatures } from './groups';
import { PAD_LINE_WIDTH, SignaturePad } from './SignaturePad';
import { useSignatures, WrongPinError } from './SignatureProvider';
import { InvalidBackupError } from './store';
import { loadScriptFont, SCRIPT_FONTS, typedSignature, type ScriptFont } from './typed';

const MIN_PIN_LENGTH = 4;

export function UnlockForm() {
  const { t } = useI18n();
  const library = useSignatures();
  const [pin, setPin] = useState('');
  const [wrong, setWrong] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const unlocked = await library.unlock(pin);
    setWrong(!unlocked);
    if (unlocked) setPin('');
  };

  return (
    <form className="pin-form" onSubmit={submit}>
      <p>
        <Icon name="lock" /> {t.locked}
      </p>
      <div className="form-row">
        <label className="field">
          <span className="field__label">{t.pin}</span>
          <input type="password" autoComplete="off" value={pin} onChange={(event) => setPin(event.target.value)} autoFocus />
        </label>
        <button type="submit" className="button button--primary" disabled={library.busy || !pin}>
          {library.busy ? t.working : t.unlock}
        </button>
      </div>
      {wrong && (
        <p className="form-error" role="alert">
          {t.wrongPin}
        </p>
      )}
    </form>
  );
}

function NewPinForm({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const library = useSignatures();
  const [pin, setPin] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pin.length < MIN_PIN_LENGTH) return setError(t.pinTooShort);
    if (pin !== repeat) return setError(t.pinMismatch);
    await library.setPin(pin);
    onDone();
  };

  return (
    <form className="pin-form" onSubmit={submit}>
      <div className="form-row">
        <label className="field">
          <span className="field__label">{t.pin}</span>
          <input type="password" autoComplete="new-password" value={pin} onChange={(event) => setPin(event.target.value)} autoFocus />
        </label>
        <label className="field">
          <span className="field__label">{t.pinRepeat}</span>
          <input type="password" autoComplete="new-password" value={repeat} onChange={(event) => setRepeat(event.target.value)} />
        </label>
        <button type="submit" className="button button--primary" disabled={library.busy}>
          {library.busy ? t.working : t.setPin}
        </button>
      </div>
      <p className="field-hint">{t.pinHint}</p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

function SignatureList() {
  const { t } = useI18n();
  const library = useSignatures();
  const groups = groupSignatures(library.signatures);

  if (groups.length === 0) return <p className="muted">{t.noSignatures}</p>;
  return (
    <ul className="signature-groups">
      {groups.map((group) => (
        <li key={group.name} className="signature-group">
          <div className="signature-group__header">
            <input
              type="text"
              aria-label={t.signatureName}
              defaultValue={group.name}
              // renaming moves every variant; giving a group another group's name merges them
              onBlur={async (event) => {
                const name = event.target.value.trim();
                if (!name || name === group.name) return;
                for (const variant of group.variants) await library.rename(variant.id, name);
              }}
              onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
            />
            {group.variants.length > 1 && <span className="muted">{t.variantCount(group.variants.length)}</span>}
          </div>
          <ul className="signature-variants">
            {group.variants.map((signature, index) => (
              <li key={signature.id} className="signature-item">
                <span className="signature-tile doc-surface">
                  <img src={signature.url} alt="" />
                </span>
                <button
                  type="button"
                  className="icon-button icon-button--danger"
                  title={t.deleteSignature}
                  aria-label={`${t.deleteSignature}: ${group.name}${group.variants.length > 1 ? ` (${index + 1})` : ''}`}
                  onClick={() => window.confirm(t.confirmDeleteSignature(group.name)) && library.remove(signature.id)}
                >
                  <Icon name="trash" size={16} />
                </button>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

/** Shows a canvas made elsewhere (the cut-out signatures) without copying it. */
function CanvasView({ canvas }: { canvas: HTMLCanvasElement }) {
  return <span className="signature-candidate__image" ref={(element) => element?.replaceChildren(canvas)} />;
}

function SignatureCreator() {
  const { t } = useI18n();
  const library = useSignatures();
  const namesId = useId();
  const [mode, setMode] = useState<'draw' | 'upload' | 'type'>('draw');
  const [typedText, setTypedText] = useState('');
  const [scriptFont, setScriptFont] = useState<ScriptFont>('dancing');
  const [typedInk, setTypedInk] = useState<InkColor>('blue');
  const [fontsReady, setFontsReady] = useState(false);
  const [name, setName] = useState('');
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [ink, setInk] = useState<InkColor>('black');
  const [uploads, setUploads] = useState<ImageData[]>([]);
  const [uploadFailed, setUploadFailed] = useState(false);
  const [sensitivity, setSensitivity] = useState(0.5);
  const [grouping, setGrouping] = useState(0.5);
  const [uploadInk, setUploadInk] = useState<InkColor | 'original'>('original');
  const [excluded, setExcluded] = useState<ReadonlySet<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // sliders stay smooth on slow machines: the images are reprocessed when React has time
  const deferredSensitivity = useDeferredValue(sensitivity);
  const deferredGrouping = useDeferredValue(grouping);
  const cleaned = useMemo(
    () => uploads.map((upload) => cleanBackground(upload, deferredSensitivity, uploadInk)),
    [uploads, deferredSensitivity, uploadInk],
  );
  const candidates = useMemo(() => cleaned.flatMap((image) => splitSignatures(image, deferredGrouping)), [cleaned, deferredGrouping]);
  useEffect(() => setExcluded(new Set()), [candidates]);
  const chosen = candidates.filter((_, index) => !excluded.has(index));

  // the handwriting fonts load only once someone opens this tab
  useEffect(() => {
    if (mode !== 'type' || fontsReady) return;
    let cancelled = false;
    Promise.all((Object.keys(SCRIPT_FONTS) as ScriptFont[]).map(loadScriptFont)).then(
      () => !cancelled && setFontsReady(true),
      (error) => console.error('Could not load handwriting fonts', error),
    );
    return () => {
      cancelled = true;
    };
  }, [mode, fontsReady]);

  const groupNames = groupSignatures(library.signatures).map((group) => group.name);
  const defaultName = t.signatureDefaultName(groupNames.length + 1);
  const canSave = mode === 'draw' ? strokes.length > 0 : mode === 'type' ? typedText.trim().length > 0 && fontsReady : chosen.length > 0;

  const save = async () => {
    setSaving(true);
    try {
      const finalName = name.trim() || defaultName;
      if (mode === 'upload') {
        // every signature cut from the scans goes under the same name: variants of one signature
        for (const canvas of chosen) await library.add(await canvasToSignature(canvas, finalName));
      } else {
        await library.add(
          mode === 'draw'
            ? await strokesToSignature(strokes, INK_COLORS[ink], PAD_LINE_WIDTH, finalName)
            : await typedSignature(typedText.trim(), scriptFont, INK_COLORS[typedInk], finalName),
        );
      }
      setStrokes([]);
      setUploads([]);
      setTypedText('');
      setName('');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="signature-creator">
      <div className="segmented" role="group">
        <button type="button" aria-pressed={mode === 'draw'} onClick={() => setMode('draw')}>
          <Icon name="pencil" size={16} />
          {t.drawTab}
        </button>
        <button type="button" aria-pressed={mode === 'type'} onClick={() => setMode('type')}>
          <Icon name="text" size={16} />
          {t.typeTab}
        </button>
        <button type="button" aria-pressed={mode === 'upload'} onClick={() => setMode('upload')}>
          <Icon name="image" size={16} />
          {t.uploadTab}
        </button>
      </div>

      {mode === 'draw' ? (
        <>
          <SignaturePad strokes={strokes} onChange={setStrokes} color={INK_COLORS[ink]} />
          <div className="form-row">
            <label className="field">
              <span className="field__label">{t.inkColor}</span>
              <select value={ink} onChange={(event) => setInk(event.target.value as InkColor)}>
                <option value="black">{t.inkBlack}</option>
                <option value="blue">{t.inkBlue}</option>
              </select>
            </label>
            <button type="button" className="button" disabled={strokes.length === 0} onClick={() => setStrokes(strokes.slice(0, -1))}>
              <Icon name="undo" />
              {t.undo}
            </button>
            <button type="button" className="button button--quiet" disabled={strokes.length === 0} onClick={() => setStrokes([])}>
              {t.clear}
            </button>
          </div>
        </>
      ) : mode === 'type' ? (
        <>
          <label className="field field--block">
            <span className="field__label">{t.typedName}</span>
            <input type="text" value={typedText} placeholder={t.typedPlaceholder} onChange={(event) => setTypedText(event.target.value)} />
          </label>
          <fieldset className="script-choices">
            <legend className="field__label">{t.scriptStyle}</legend>
            {(Object.keys(SCRIPT_FONTS) as ScriptFont[]).map((font) => (
              <label key={font} className="script-choice">
                <input type="radio" name="script-font" checked={scriptFont === font} onChange={() => setScriptFont(font)} />
                <span
                  className="script-choice__sample doc-surface"
                  style={{ fontFamily: fontsReady ? `"${SCRIPT_FONTS[font].family}"` : undefined, color: INK_COLORS[typedInk] }}
                >
                  {typedText.trim() || t.typedPlaceholder}
                </span>
              </label>
            ))}
          </fieldset>
          <label className="field">
            <span className="field__label">{t.inkColor}</span>
            <select value={typedInk} onChange={(event) => setTypedInk(event.target.value as InkColor)}>
              <option value="black">{t.inkBlack}</option>
              <option value="blue">{t.inkBlue}</option>
            </select>
          </label>
        </>
      ) : (
        <>
          <p className="muted">{t.uploadHint}</p>
          <div className="form-row">
            <button type="button" className="button" onClick={() => fileInput.current?.click()}>
              <Icon name="image" />
              {t.chooseImage}
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="image/*,.heic,.heif"
              multiple
              hidden
              onChange={async (event) => {
                const files = [...(event.target.files ?? [])];
                event.target.value = '';
                if (files.length === 0) return;
                const decoded = await Promise.allSettled(files.map(decodeUpload));
                setUploads(decoded.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : [])));
                setUploadFailed(decoded.some((result) => result.status === 'rejected'));
              }}
            />
          </div>
          {uploadFailed && <p className="form-error">{t.imageNotSupported}</p>}
          {uploads.length > 0 && (
            <>
              {candidates.length > 1 && <p className="muted">{t.foundSignatures(candidates.length)}</p>}
              <div className="signature-preview">
                {candidates.length === 0 ? (
                  <p className="form-error">{t.noInkFound}</p>
                ) : (
                  candidates.map((canvas, index) => (
                    <label key={index} className="signature-candidate">
                      <input
                        type="checkbox"
                        checked={!excluded.has(index)}
                        aria-label={t.useCandidate(index + 1)}
                        onChange={() =>
                          setExcluded((current) => {
                            const next = new Set(current);
                            if (next.has(index)) next.delete(index);
                            else next.add(index);
                            return next;
                          })
                        }
                      />
                      <CanvasView canvas={canvas} />
                    </label>
                  ))
                )}
              </div>
              <div className="form-row">
                <label className="field field--grow">
                  <span className="field__label">{t.backgroundRemoval}</span>
                  <input type="range" min={0} max={1} step={0.05} value={sensitivity} onChange={(event) => setSensitivity(event.target.valueAsNumber)} />
                </label>
                <label className="field field--grow">
                  <span className="field__label">{t.strokeGrouping}</span>
                  <input type="range" min={0} max={1} step={0.05} value={grouping} onChange={(event) => setGrouping(event.target.valueAsNumber)} />
                </label>
                <label className="field">
                  <span className="field__label">{t.inkColor}</span>
                  <select value={uploadInk} onChange={(event) => setUploadInk(event.target.value as InkColor | 'original')}>
                    <option value="original">{t.inkOriginal}</option>
                    <option value="black">{t.inkBlack}</option>
                    <option value="blue">{t.inkBlue}</option>
                  </select>
                </label>
              </div>
            </>
          )}
        </>
      )}

      <div className="form-row">
        <label className="field field--grow">
          <span className="field__label">{t.signatureName}</span>
          <input type="text" list={namesId} value={name} placeholder={defaultName} onChange={(event) => setName(event.target.value)} />
          <datalist id={namesId}>
            {groupNames.map((existing) => (
              <option key={existing} value={existing} />
            ))}
          </datalist>
        </label>
        <button type="button" className="button button--primary" disabled={!canSave || saving} onClick={save}>
          {mode === 'upload' && chosen.length > 1 ? t.saveSignatures(chosen.length) : t.saveSignature}
        </button>
      </div>
      <p className="field-hint">{t.variantsHint}</p>
    </div>
  );
}

function ProtectionSection() {
  const { t } = useI18n();
  const library = useSignatures();
  const [settingPin, setSettingPin] = useState(false);

  return (
    <section className="dialog-section">
      <h3>{t.protection}</h3>
      <p className="muted">{library.encrypted ? t.protectedInfo : t.unprotectedInfo}</p>
      {!settingPin && (
        <div className="form-row">
          {library.encrypted ? (
            <>
              <button type="button" className="button" onClick={library.lock}>
                <Icon name="lock" />
                {t.lock}
              </button>
              <button type="button" className="button" onClick={() => setSettingPin(true)}>
                {t.changePin}
              </button>
              <button
                type="button"
                className="button button--quiet"
                disabled={library.busy}
                onClick={() => window.confirm(t.confirmRemovePin) && library.removePin()}
              >
                {t.removePin}
              </button>
            </>
          ) : (
            <button type="button" className="button" onClick={() => setSettingPin(true)}>
              <Icon name="lock" />
              {t.setPin}
            </button>
          )}
        </div>
      )}
      {settingPin && <NewPinForm onDone={() => setSettingPin(false)} />}
    </section>
  );
}

function BackupSection() {
  const { t } = useI18n();
  const library = useSignatures();
  const [pendingBackup, setPendingBackup] = useState<string | null>(null);
  const [backupPin, setBackupPin] = useState('');
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const restore = async (text: string, pin?: string) => {
    try {
      const added = await library.importBackup(text, pin);
      setMessage({ text: t.restored(added), error: false });
      setPendingBackup(null);
      setBackupPin('');
    } catch (error) {
      setMessage({ text: error instanceof WrongPinError ? t.wrongPin : t.invalidBackup, error: true });
    }
  };

  return (
    <section className="dialog-section">
      <h3>{t.backup}</h3>
      <p className="muted">{t.backupInfo}</p>
      <div className="form-row">
        <button
          type="button"
          className="button"
          disabled={library.signatures.length === 0}
          onClick={async () => downloadBlob(await library.exportBackup(), `pdforge-signatures-${new Date().toISOString().slice(0, 10)}.json`)}
        >
          <Icon name="download" />
          {t.exportBackup}
        </button>
        <button type="button" className="button" onClick={() => fileInput.current?.click()}>
          <Icon name="upload" />
          {t.importBackup}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            const text = await file.text();
            setMessage(null);
            try {
              if (library.backupNeedsPin(text)) setPendingBackup(text);
              else await restore(text);
            } catch (error) {
              setMessage({ text: error instanceof InvalidBackupError ? t.invalidBackup : String(error), error: true });
            }
          }}
        />
      </div>
      {pendingBackup && (
        <form
          className="form-row"
          onSubmit={(event) => {
            event.preventDefault();
            void restore(pendingBackup, backupPin);
          }}
        >
          <label className="field">
            <span className="field__label">{t.backupPin}</span>
            <input type="password" autoComplete="off" value={backupPin} onChange={(event) => setBackupPin(event.target.value)} autoFocus />
          </label>
          <button type="submit" className="button button--primary" disabled={library.busy || !backupPin}>
            {library.busy ? t.working : t.restore}
          </button>
        </form>
      )}
      {message && (
        <p className={message.error ? 'form-error' : 'form-success'} role="status">
          {message.text}
        </p>
      )}
    </section>
  );
}

export function SignatureManager({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const library = useSignatures();

  return (
    <Dialog title={t.mySignatures} onClose={onClose} wide>
      {library.status === 'loading' && <span className="spinner" aria-hidden="true" />}
      {library.status === 'unavailable' && <p className="form-error">{t.storageUnavailable}</p>}
      {library.status === 'locked' && (
        <>
          <UnlockForm />
          <section className="dialog-section">
            <h3>{t.forgotPin}</h3>
            <button
              type="button"
              className="button button--danger"
              onClick={() => window.confirm(t.confirmReset) && library.reset()}
            >
              <Icon name="trash" />
              {t.resetSignatures}
            </button>
          </section>
        </>
      )}
      {library.status === 'ready' && (
        <>
          <section className="dialog-section">
            <h3>{t.savedSignatures}</h3>
            <SignatureList />
          </section>
          <section className="dialog-section">
            <h3>{t.newSignature}</h3>
            <SignatureCreator />
          </section>
          <ProtectionSection />
          <BackupSection />
        </>
      )}
      <p className="dialog__note">{t.storageNote}</p>
    </Dialog>
  );
}
