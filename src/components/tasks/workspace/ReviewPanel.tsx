import { useEffect, useState } from 'react';
import { EyeOff, Save } from 'lucide-react';
import type { Task } from '../../../types';
import { useLanguageStore } from '../../../store';
import StatusBadge from '../../shared/StatusBadge';
import DateDisplay from '../../shared/DateDisplay';
import CopyButton from '../../shared/CopyButton';

interface Props {
  task: Task;
  isAdmin: boolean;
  onSaveNotes: (notes: string) => Promise<void>;
  saving: boolean;
}

export default function ReviewPanel({ task, isAdmin, onSaveNotes, saving }: Props) {
  const { t } = useLanguageStore();
  const [notes, setNotes] = useState(task.admin_notes || '');

  useEffect(() => {
    setNotes(task.admin_notes || '');
  }, [task.admin_notes, task.id]);

  const notesDirty = notes !== (task.admin_notes || '');

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
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => void onSaveNotes(notes)}
              disabled={saving || !notesDirty}
            >
              <Save size={14} aria-hidden="true" />
              {t('common.save')}
            </button>
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
