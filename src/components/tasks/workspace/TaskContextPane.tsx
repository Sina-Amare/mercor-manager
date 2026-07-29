import { UserRound } from 'lucide-react';
import type { Task, User } from '../../../types';
import { useLanguageStore } from '../../../store';
import CopyButton from '../../shared/CopyButton';
import DateDisplay from '../../shared/DateDisplay';

interface Props {
  task: Task;
  isAdmin: boolean;
  assignableMembers: User[];
  onRequestReassign: (memberId: string) => void;
  saving: boolean;
}

/**
 * The brief. Pinned beside every stage because it is the one thing you need in
 * front of you no matter which step you are on — previously you had to scroll
 * back up past the work fields to re-read the task.
 */
export default function TaskContextPane({
  task,
  isAdmin,
  assignableMembers,
  onRequestReassign,
  saving,
}: Props) {
  const { t } = useLanguageStore();
  const assignee = task.expand?.assigned_to;

  return (
    <aside className="task-context" aria-label={t('tasks.the_task')}>
      <div className="task-context-block">
        <div className="task-copy-heading">
          <h2 className="task-detail-field-label">{t('upload.body_label')}</h2>
          <CopyButton
            text={task.body}
            compact
            ariaLabel={`${t('common.copy')}: ${t('upload.body_label')}`}
          />
        </div>
        <div className="task-detail-body-text">{task.body}</div>
      </div>

      <div className="task-context-block">
        <div className="task-detail-field-label">{t('tasks.assigned_to')}</div>
        {isAdmin ? (
          <>
            <select
              className="form-select"
              value={task.assigned_to}
              onChange={(event) => onRequestReassign(event.target.value)}
              disabled={saving}
              aria-describedby="task-reassign-help"
            >
              {assignableMembers.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name} (@{member.username})
                </option>
              ))}
              {!assignableMembers.some((member) => member.id === task.assigned_to) && (
                <option value={task.assigned_to}>
                  {assignee?.name || t('tasks.unknown_member')}
                </option>
              )}
            </select>
            <small className="task-context-hint" id="task-reassign-help">
              {t('tasks.reassign_help')}
            </small>
          </>
        ) : (
          <div className="member-cell">
            <div className="member-avatar" aria-hidden="true">
              {assignee?.name?.charAt(0).toUpperCase() || <UserRound size={14} />}
            </div>
            <span className="task-context-assignee">{assignee?.name || '—'}</span>
          </div>
        )}
      </div>

      <dl className="task-context-meta">
        <div>
          <dt>{t('tasks.created')}</dt>
          <dd>
            <DateDisplay date={task.created} />
          </dd>
        </div>
        {task.member_verdict_date && (
          <div>
            <dt>{t('tasks.member_verdict')}</dt>
            <dd>
              <DateDisplay date={task.member_verdict_date} />
            </dd>
          </div>
        )}
        {task.admin_verdict_date && (
          <div>
            <dt>{t('tasks.admin_verdict')}</dt>
            <dd>
              <DateDisplay date={task.admin_verdict_date} />
            </dd>
          </div>
        )}
        <div>
          <dt>{t('tasks.updated')}</dt>
          <dd>
            <DateDisplay date={task.updated} />
          </dd>
        </div>
      </dl>
    </aside>
  );
}
