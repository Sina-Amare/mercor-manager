import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, Loader2, X } from 'lucide-react';
import { useLanguageStore } from '../../store';
import useFocusTrap from '../../hooks/useFocusTrap';

export type ConfirmTone = 'default' | 'warning' | 'danger';

interface Props {
  open: boolean;
  title: string;
  /** Body copy or richer content explaining exactly what is about to happen. */
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
  busy?: boolean;
  /**
   * Requires the phrase to be typed before confirming. Reserved for actions
   * that overwrite data wholesale — a click is too cheap for those.
   */
  typeToConfirm?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const TONE_BUTTON: Record<ConfirmTone, string> = {
  default: 'btn-primary',
  warning: 'btn-warning',
  danger: 'btn-danger',
};

export default function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel,
  tone = 'default',
  busy = false,
  typeToConfirm,
  onConfirm,
  onCancel,
}: Props) {
  const { t } = useLanguageStore();
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [typed, setTyped] = useState('');

  useFocusTrap(dialogRef, open, busy ? undefined : onCancel);

  useEffect(() => {
    if (!open) setTyped('');
  }, [open]);

  if (!open) return null;

  const confirmBlocked = Boolean(typeToConfirm) && typed.trim() !== typeToConfirm;

  return (
    <>
      <button
        type="button"
        className="modal-backdrop"
        aria-label={t('common.cancel')}
        onClick={() => !busy && onCancel()}
      />
      <div
        ref={dialogRef}
        className={`modal confirm-dialog confirm-${tone}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="modal-header">
          <h2 className="modal-title" id={titleId}>
            {tone !== 'default' && <AlertTriangle size={18} aria-hidden="true" />}
            {title}
          </h2>
          <button
            type="button"
            className="btn btn-ghost btn-icon btn-sm"
            onClick={onCancel}
            disabled={busy}
            aria-label={t('common.close')}
          >
            <X size={16} />
          </button>
        </div>

        <div className="modal-body">
          {children}
          {typeToConfirm && (
            <div className="form-group confirm-type-to-confirm">
              <label className="form-label" htmlFor={`${titleId}-type`}>
                {t('common.type_to_confirm').replace('{phrase}', typeToConfirm)}
              </label>
              <input
                id={`${titleId}-type`}
                className="form-input input-mono"
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                autoComplete="off"
                data-autofocus
              />
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>
            {cancelLabel || t('common.cancel')}
          </button>
          <button
            type="button"
            className={`btn ${TONE_BUTTON[tone]}`}
            onClick={onConfirm}
            disabled={busy || confirmBlocked}
          >
            {busy && <Loader2 size={15} className="spin" aria-hidden="true" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </>
  );
}
