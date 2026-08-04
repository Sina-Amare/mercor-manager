import { NavLink } from 'react-router-dom';
import type { Task, User } from '../../types';
import { useLanguageStore } from '../../store';
import { formatNumber } from '../../utils/dates';
import { tasksInQueue, type Queue } from '../../queues';

interface Props {
  queues: Queue[];
  tasks: Task[];
  user: User | null;
  title: string;
}

/**
 * The named work piles, with live counts.
 *
 * Every queue stays listed even at zero — a section that appears and disappears
 * as work moves is one you cannot learn, and "is anything waiting on me?" has to
 * be answerable by glancing, not by hunting through a filter.
 */
export default function QueueNav({ queues, tasks, user, title }: Props) {
  const { t, language } = useLanguageStore();
  if (queues.length === 0) return null;

  return (
    <div className="sidebar-section">
      <div className="sidebar-section-title">{title}</div>
      <ul className="sidebar-nav">
        {queues.map((queue) => {
          const count = tasksInQueue(queue, tasks, user).length;
          const waiting = Boolean(queue.needsAction) && count > 0;

          return (
            <li key={queue.id}>
              <NavLink
                to={`/queue/${queue.id}`}
                className={({ isActive }) =>
                  `sidebar-link queue-link ${isActive ? 'active' : ''} ${
                    waiting ? 'is-waiting' : ''
                  } ${count === 0 ? 'is-empty' : ''}`
                }
                title={t(queue.helpKey)}
              >
                {waiting && <span className="queue-dot" aria-hidden="true" />}
                <span className="queue-label">{t(queue.labelKey)}</span>
                <span className="sidebar-link-badge">{formatNumber(count, language)}</span>
              </NavLink>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
