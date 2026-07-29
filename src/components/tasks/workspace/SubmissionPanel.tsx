import { AlertCircle, Save } from 'lucide-react';
import type { Task } from '../../../types';
import { useLanguageStore } from '../../../store';
import FieldEditor from './FieldEditor';
import type { Draft, DraftField } from './useTaskDraft';

interface Props {
  task: Task;
  draft: Draft;
  setField: (field: DraftField, value: string) => void;
  canEdit: boolean;
  dirty: boolean;
  remoteChanged: boolean;
  onLoadLatest: () => void;
  onSave: () => void;
  saving: boolean;
}

export default function SubmissionPanel({
  task,
  draft,
  setField,
  canEdit,
  dirty,
  remoteChanged,
  onLoadLatest,
  onSave,
  saving,
}: Props) {
  const { t } = useLanguageStore();

  return (
    <div className="stage-panel">
      <header className="stage-panel-header">
        <div>
          <h2>{t('tasks.submission_details')}</h2>
          <p>{t('tasks.submission_help')}</p>
        </div>
      </header>

      {task.status === 'assigned' && (
        <div className="stage-notice is-info" role="note">
          <AlertCircle size={18} aria-hidden="true" />
          <div>
            <strong>{t('tasks.not_started_title')}</strong>
            <span>{t('tasks.not_started_help')}</span>
          </div>
        </div>
      )}

      {task.status === 'sent_back' && (
        <div className="stage-notice is-warning" role="note">
          <AlertCircle size={18} aria-hidden="true" />
          <div>
            <strong>{t('tasks.sent_back_title')}</strong>
            <span>{task.admin_notes?.trim() || t('tasks.sent_back_help')}</span>
          </div>
        </div>
      )}

      {remoteChanged && (
        <div className="stage-notice is-warning" role="alert">
          <AlertCircle size={18} aria-hidden="true" />
          <div>
            <strong>{t('tasks.submission_changed_remote_title')}</strong>
            <span>{t('tasks.submission_changed_remote_help')}</span>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={onLoadLatest} disabled={saving}>
            {t('tasks.load_latest')}
          </button>
        </div>
      )}

      {!canEdit && (
        <div className="stage-notice is-readonly" role="note">
          {t('tasks.submission_readonly')}
        </div>
      )}

      <div className="stage-field-grid">
        <FieldEditor
          id="task-submission-prompt"
          label={t('tasks.submission_prompt')}
          value={draft.submission_prompt}
          onChange={(value) => setField('submission_prompt', value)}
          placeholder={t('tasks.submission_prompt_placeholder')}
          readOnly={!canEdit}
          aiAssist
        />
        <FieldEditor
          id="task-submission-dsp"
          label={t('tasks.submission_dsp')}
          value={draft.submission_dsp}
          onChange={(value) => setField('submission_dsp', value)}
          placeholder={t('tasks.submission_dsp_placeholder')}
          readOnly={!canEdit}
          aiAssist
        />
        <FieldEditor
          id="task-submission-final-answer"
          label={t('tasks.submission_final_answer')}
          value={draft.submission_final_answer}
          onChange={(value) => setField('submission_final_answer', value)}
          placeholder={t('tasks.submission_final_answer_placeholder')}
          readOnly={!canEdit}
          aiAssist
        />
        <FieldEditor
          id="task-submission-notes"
          label={t('tasks.submission_notes')}
          value={draft.submission_notes}
          onChange={(value) => setField('submission_notes', value)}
          placeholder={t('tasks.submission_notes_placeholder')}
          help={t('tasks.submission_notes_help')}
          readOnly={!canEdit}
          aiAssist
        />
      </div>

      {canEdit && (
        <div className="stage-panel-actions">
          <button className="btn btn-secondary btn-sm" onClick={onSave} disabled={saving || !dirty}>
            <Save size={14} aria-hidden="true" />
            {t('tasks.save_draft')}
          </button>
        </div>
      )}
    </div>
  );
}
