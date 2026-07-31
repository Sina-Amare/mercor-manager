import { AlertCircle } from 'lucide-react';
import type { Task } from '../../../types';
import { useLanguageStore } from '../../../store';
import FieldEditor from './FieldEditor';
import SaveIndicator from './SaveIndicator';
import type { Draft, DraftField, SaveState } from './useTaskDraft';

interface Props {
  task: Task;
  draft: Draft;
  setField: (field: DraftField, value: string) => void;
  canEdit: boolean;
  isAdmin: boolean;
  dirty: boolean;
  saveState: SaveState;
  lastSavedAt: string | null;
  onRetrySave: () => void;
}

export default function StudioPanel({
  task,
  draft,
  setField,
  canEdit,
  isAdmin,
  dirty,
  saveState,
  lastSavedAt,
  onRetrySave,
}: Props) {
  const { t } = useLanguageStore();
  const inStudio = task.status === 'in_studio';

  return (
    <div className="stage-panel">
      <header className="stage-panel-header">
        <div>
          <h2>{t('tasks.stage_studio')}</h2>
          <p>{t('tasks.studio_help')}</p>
        </div>
      </header>

      {task.status === 'on_hold' && (
        <div className="stage-notice is-info" role="note">
          <AlertCircle size={18} aria-hidden="true" />
          <div>
            <strong>{t('status.on_hold')}</strong>
            <span>{t('tasks.on_hold_help')}</span>
          </div>
        </div>
      )}

      {inStudio && (
        <div className="stage-notice is-studio" role="note">
          <AlertCircle size={18} aria-hidden="true" />
          <div>
            <strong>{t('tasks.studio_workflow_title')}</strong>
            <span>
              {isAdmin
                ? t('tasks.studio_workflow_admin_help')
                : t('tasks.studio_workflow_member_help')}
            </span>
          </div>
        </div>
      )}

      <FieldEditor
        id="task-studio-result"
        label={t('tasks.studio_result')}
        help={t('tasks.studio_result_help')}
        value={draft.studio_result}
        onChange={(value) => setField('studio_result', value)}
        placeholder={t('tasks.studio_result_placeholder')}
        readOnly={!canEdit}
        tone="studio"
        rows={6}
      />

      {/* The same shared note as on the Submission stage. It is required before
          a task can leave Studio, so it is repeated here rather than making
          somebody hunt for it on another tab. */}
      <FieldEditor
        id="task-studio-notes"
        label={inStudio ? t('tasks.submission_notes_required') : t('tasks.submission_notes')}
        value={draft.submission_notes}
        onChange={(value) => setField('submission_notes', value)}
        placeholder={t('tasks.submission_notes_placeholder')}
        help={inStudio ? t('tasks.review_note_help') : undefined}
        required={inStudio}
        readOnly={!canEdit}
        rows={6}
      />


      {canEdit && (
        <div className="stage-panel-actions">
          <SaveIndicator
            state={saveState}
            dirty={dirty}
            lastSavedAt={lastSavedAt}
            onRetry={onRetrySave}
          />
        </div>
      )}
    </div>
  );
}
