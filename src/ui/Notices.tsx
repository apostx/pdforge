import { useI18n } from '../i18n';
import type { AppError } from '../workspace/types';
import { Icon } from './Icon';

export function Notices({ errors, onDismiss }: { errors: AppError[]; onDismiss: (id: string) => void }) {
  const { t } = useI18n();

  const message = (error: AppError) => {
    switch (error.kind) {
      case 'encrypted':
        return t.errorEncrypted(error.fileName);
      case 'unsupported':
        return t.errorUnsupported(error.fileName);
      case 'unreadable':
        return t.errorUnreadable(error.fileName);
      case 'export':
        return t.errorExport;
    }
  };

  return (
    <div className="notices" role="status" aria-live="polite">
      {errors.map((error) => (
        <div key={error.id} className="notice">
          <span>{message(error)}</span>
          <button type="button" className="icon-button" onClick={() => onDismiss(error.id)} title={t.dismiss} aria-label={t.dismiss}>
            <Icon name="close" size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}
