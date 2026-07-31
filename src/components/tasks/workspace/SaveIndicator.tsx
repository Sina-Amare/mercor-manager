import { AlertCircle, Check, Loader2, RotateCw } from 'lucide-react';
import { useLanguageStore } from '../../../store';
import { formatRelativeTime } from '../../../utils/dates';
import type { SaveState } from './useTaskDraft';

interface Props {
  state: SaveState;
  dirty: boolean;
  lastSavedAt: string | null;
  onRetry: () => void;
}

/**
 * Replaces the Save button. Saving happens on its own, so the job here is to
 * say so — an editor that writes silently is indistinguishable from one that
 * has quietly stopped writing, which is the failure this whole change is about.
 */
export default function SaveIndicator({ state, dirty, lastSavedAt, onRetry }: Props) {
  const { t, language } = useLanguageStore();

  if (state === 'error') {
    return (
      <div className="save-indicator is-error" role="alert">
        <AlertCircle size={14} aria-hidden="true" />
        <span>{t('tasks.autosave_failed')}</span>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onRetry}>
          <RotateCw size={13} aria-hidden="true" />
          {t('tasks.autosave_retry')}
        </button>
      </div>
    );
  }

  if (state === 'saving') {
    return (
      <p className="save-indicator" role="status">
        <Loader2 size={14} className="spin" aria-hidden="true" />
        {t('tasks.autosave_saving')}
      </p>
    );
  }

  if (dirty) {
    return (
      <p className="save-indicator is-pending" role="status">
        {t('tasks.autosave_pending')}
      </p>
    );
  }

  if (lastSavedAt) {
    return (
      <p className="save-indicator is-saved" role="status">
        <Check size={14} aria-hidden="true" />
        {t('tasks.autosave_saved')} {formatRelativeTime(lastSavedAt, language)}
      </p>
    );
  }

  return (
    <p className="save-indicator is-idle" role="status">
      {t('tasks.autosave_idle')}
    </p>
  );
}
