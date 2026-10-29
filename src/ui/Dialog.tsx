import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useI18n } from '../i18n';
import { Icon } from './Icon';

interface DialogProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}

/** A modal on the native <dialog>: focus trapping, Escape and the top layer come for free. Mount it to open it. */
export function Dialog({ title, onClose, children, wide }: DialogProps) {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      className={wide ? 'dialog dialog--wide' : 'dialog'}
      aria-labelledby={titleId}
      onClose={onClose}
      // a click on the backdrop lands on the <dialog> element itself
      onClick={(event) => event.target === event.currentTarget && ref.current?.close()}
    >
      <div className="dialog__header">
        <h2 id={titleId}>{title}</h2>
        <button type="button" className="icon-button" onClick={() => ref.current?.close()} title={t.close} aria-label={t.close}>
          <Icon name="close" size={16} />
        </button>
      </div>
      <div className="dialog__body">{children}</div>
    </dialog>
  );
}
