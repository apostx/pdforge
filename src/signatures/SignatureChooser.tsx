import { useI18n } from '../i18n';
import { Icon } from '../ui/Icon';
import { UnlockForm } from './SignatureManager';
import { groupSignatures, type SignatureGroup } from './groups';
import { useSignatures } from './SignatureProvider';

interface SignatureChooserProps {
  value: SignatureGroup | undefined;
  /** Called with the chosen signature's name; same-named signatures are its variants. */
  onChange: (name: string) => void;
  onManage: () => void;
}

/** Picks one saved signature (with its variants); covers the locked, empty and unavailable states too. */
export function SignatureChooser({ value, onChange, onManage }: SignatureChooserProps) {
  const { t } = useI18n();
  const library = useSignatures();

  if (library.status === 'loading') return <span className="spinner" aria-hidden="true" />;
  if (library.status === 'unavailable') return <p className="form-error">{t.storageUnavailable}</p>;
  if (library.status === 'locked') return <UnlockForm />;
  if (library.signatures.length === 0) {
    return (
      <div className="signature-empty">
        <p className="muted">{t.noSignatures}</p>
        <button type="button" className="button button--primary" onClick={onManage}>
          <Icon name="signature" />
          {t.manageSignatures}
        </button>
      </div>
    );
  }

  return (
    <fieldset className="signature-choices">
      <legend className="field__label">{t.chooseSignature}</legend>
      {groupSignatures(library.signatures).map((group) => (
        <label key={group.name} className="signature-choice">
          <input type="radio" name="signature" checked={value?.name === group.name} onChange={() => onChange(group.name)} />
          <span className={group.variants.length > 1 ? 'signature-tile signature-tile--stack doc-surface' : 'signature-tile doc-surface'}>
            <img src={group.variants[0].url} alt="" />
          </span>
          <span className="signature-choice__name">{group.name}</span>
          {group.variants.length > 1 && <span className="signature-choice__count">{t.variantCount(group.variants.length)}</span>}
        </label>
      ))}
      <button type="button" className="button button--quiet" onClick={onManage}>
        {t.manageSignatures}
      </button>
    </fieldset>
  );
}
