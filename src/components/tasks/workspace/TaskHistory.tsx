import { useEffect, useState } from 'react';
import { ArrowRight, History, Loader2 } from 'lucide-react';
import { fetchTaskEvents, type TaskEvent } from '../../../api/taskEvents';
import { useAppStore, useLanguageStore } from '../../../store';
import StatusBadge from '../../shared/StatusBadge';
import DateDisplay from '../../shared/DateDisplay';

interface Props {
  taskId: string;
  /** Bumped whenever the task changes, so the feed reloads after an action. */
  revision: string;
}

/**
 * Who changed what, and when. This is what makes one-click reversals and
 * sideways verdict corrections safe to offer: every one of them leaves a trace.
 */
export default function TaskHistory({ taskId, revision }: Props) {
  const { t, language } = useLanguageStore();
  const { members } = useAppStore();
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    fetchTaskEvents(taskId)
      .then((rows) => active && setEvents(rows))
      .catch(() => active && setEvents([]))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [open, revision, taskId]);

  const actorName = (actorId: string | null) =>
    members.find((member) => member.id === actorId)?.name || t('tasks.unknown_member');

  return (
    <details className="task-history" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        <History size={15} aria-hidden="true" />
        {t('tasks.history')}
      </summary>

      {loading ? (
        <p className="task-history-empty">
          <Loader2 size={15} className="spin" aria-hidden="true" />
          {t('common.loading')}
        </p>
      ) : events.length === 0 ? (
        <p className="task-history-empty">{t('tasks.history_empty')}</p>
      ) : (
        <ol className="task-history-list">
          {events.map((event) => (
            <li key={event.id}>
              <div className="task-history-when">
                <DateDisplay date={event.at} />
              </div>
              <div className="task-history-what">
                <strong>{actorName(event.actor_id)}</strong>
                {event.from_status && event.to_status && event.from_status !== event.to_status ? (
                  <span className="task-history-transition">
                    <StatusBadge status={event.from_status} />
                    <ArrowRight size={13} aria-hidden="true" />
                    <StatusBadge status={event.to_status} />
                  </span>
                ) : (
                  <span className="task-history-fields">
                    {event.changed_fields
                      .map((field) => t(`tasks.field_${field}`))
                      .join(language === 'fa' ? '، ' : ', ')}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </details>
  );
}
