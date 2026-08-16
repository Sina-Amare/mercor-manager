import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, EyeOff, Loader2 } from 'lucide-react';
import type { Task } from '../../../types';
import { useLanguageStore } from '../../../store';
import StatusBadge from '../../shared/StatusBadge';
import DateDisplay from '../../shared/DateDisplay';
import CopyButton from '../../shared/CopyButton';

interface Props {
  task: Task;
  isAdmin: boolean;
  /** Persists the patch. Resolves with the stored task, or null if it failed. */
  onSaveNotes: (notes: string) => Promise<Task | null>;
}

export default function ReviewPanel({ task, isAdmin, onSaveNotes }: Props) {
  const { t } = useLanguageStore();
  const [notes, setNotes] = useState(task.admin_notes || '');
  const [notesState, setNotesState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const notesDirty = notes !== (task.admin_notes || '');
  const dirtyRef = useRef(false);
  dirtyRef.current = notesDirty;

  // Adopt the server value only when we are not mid-edit. Unconditionally
  // syncing here wiped whatever the admin was typing the moment any Realtime
  // update for this task arrived.
  useEffect(() => {
    if (!dirtyRef.current) setNotes(task.admin_notes || '');
  }, [task.admin_notes, task.id]);

  const persist = useCallback(async () => {
    if (!dirtyRef.current) return;
    setNotesState('saving');
    try {
      const saved = await onSaveNotes(notes);
      // A null here is a genuine failure — the write hook queues rather than
      // drops, so "another save was in flight" never lands on this line.
      setNotesState(saved ? 'saved' : 'error');
    } catch {
      setNotesState('error');
    }
  }, [notes, onSaveNotes]);

  // Same auto-save contract as the shared fields — no button to forget.
  useEffect(() => {
    if (!isAdmin || !notesDirty) return;
    const timer = window.setTimeout(() => void persist(), 1200);
    return () => window.clearTimeout(timer);
  }, [isAdmin, notes, notesDirty, persist]);

  return (
    <div className="stage-panel">
      <header className="stage-panel-header">
        <div>
          <h2>{t('tasks.stage_review')}</h2>
          <p>{t('tasks.review_help')}</p>
        </div>
      </header>

      <div className="review-verdict">
        <div>
          <span className="task-detail-field-label">{t('tasks.admin_verdict')}</span>
          {task.admin_verdict ? (
            <StatusBadge status={task.admin_verdict} />
          ) : (
            <span className="review-verdict-pending">{t('tasks.no_verdict_yet')}</span>
          )}
        </div>
        {task.admin_verdict_date && (
          <div>
            <span className="task-detail-field-label">{t('tasks.decided_on')}</span>
            <DateDisplay date={task.admin_verdict_date} />
          </div>
        )}
      </div>

      {isAdmin ? (
        <div className="admin-notes">
          <div className="task-copy-heading">
            <label className="task-detail-field-label" htmlFor="task-admin-notes">
              <EyeOff size={13} aria-hidden="true" />
              {t('tasks.notes')}
            </label>
            <CopyButton
              text={notes}
              compact
              ariaLabel={`${t('common.copy')}: ${t('tasks.notes')}`}
            />
          </div>
          <p className="admin-notes-scope">{t('tasks.notes_scope')}</p>
          <textarea
            id="task-admin-notes"
            className="form-textarea"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder={t('tasks.private_admin_notes_placeholder')}
            rows={4}
            dir="auto"
          />
          <div className="stage-panel-actions">
            <p
              className={`save-indicator ${
                notesState === 'saving'
                  ? 'is-pending'
                  : notesState === 'error'
                    ? 'is-error'
                    : notesDirty
                      ? 'is-pending'
                      : notesState === 'saved'
                        ? 'is-saved'
                        : 'is-idle'
              }`}
              role="status"
            >
              {notesState === 'saving' && <Loader2 size={14} className="spin" aria-hidden="true" />}
              {!notesDirty && notesState === 'saved' && <Check size={14} aria-hidden="true" />}
              {notesState === 'saving'
                ? t('tasks.autosave_saving')
                : notesState === 'error'
                  ? t('tasks.autosave_failed')
                  : notesDirty
                    ? t('tasks.autosave_pending')
                    : notesState === 'saved'
                      ? t('tasks.autosave_saved')
                      : t('tasks.autosave_idle')}
            </p>
          </div>
        </div>
      ) : task.status === 'sent_back' && task.admin_notes?.trim() ? (
        <div className="stage-notice is-warning" role="note">
          <div>
            <strong>{t('tasks.sent_back_title')}</strong>
            <span>{task.admin_notes}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
