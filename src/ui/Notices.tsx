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
      case 'editsChanged':
        return t.errorEditsChanged(error.fileName);
      case 'driveOpen':
        return error.fileName ? t.errorDriveFile(error.fileName) : t.errorDriveOpen;
      case 'driveSave':
        return t.errorDriveSave;
      case 'driveSaved':
        return t.driveSaved(error.fileName);
    }
  };

  return (
    <div className="notices" role="status" aria-live="polite">
      {errors.map((error) => (
        <div key={error.id} className={error.kind === 'driveSaved' ? 'notice notice--info' : 'notice'}>
          <span>
            {message(error)}
            {error.link && (
              <>
                {' '}
                <a href={error.link} target="_blank" rel="noopener noreferrer">
                  {t.openInDrive}
                </a>
              </>
            )}
          </span>
          <button type="button" className="icon-button" onClick={() => onDismiss(error.id)} title={t.dismiss} aria-label={t.dismiss}>
            <Icon name="close" size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}
