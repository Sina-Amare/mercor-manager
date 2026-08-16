import { RotateCcw, X } from 'lucide-react';
import { useLanguageStore, useToastStore } from '../../store';

export default function ToastContainer() {
  const { toasts, removeToast } = useToastStore();
  const { t } = useLanguageStore();

  if (toasts.length === 0) return null;

  return (
    <div className="toast-container" role="region" aria-label={t('common.notifications')}>
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`toast toast-${toast.type}`}
          // Errors interrupt; confirmations wait their turn.
          role={toast.type === 'error' ? 'alert' : 'status'}
          aria-live={toast.type === 'error' ? 'assertive' : 'polite'}
        >
          <span className="toast-message">{toast.message}</span>

          {/* This button is what lets most actions skip a confirmation modal
              entirely: acting is cheap when taking it back is one click. */}
          {toast.undo && (
            <button
              className="btn btn-sm toast-undo"
              onClick={() => {
                const undo = toast.undo;
                if (!undo) return;
                removeToast(toast.id);
                // A failed undo must not pass silently — the whole promise of
                // this button is that reversing the action is one click, so
                // when it is not, that has to be said out loud.
                void Promise.resolve(undo.run()).catch((error: unknown) => {
                  useToastStore.getState().addToast(
                    error instanceof Error && error.message
                      ? `${t('common.undo_failed')}: ${error.message}`
                      : t('common.undo_failed'),
                    'error'
                  );
                });
              }}
            >
              <RotateCcw size={13} aria-hidden="true" />
              {toast.undo.label}
            </button>
          )}

          <button
            className="btn btn-icon btn-ghost btn-sm toast-dismiss"
            onClick={() => removeToast(toast.id)}
            aria-label={t('common.dismiss')}
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
