import { useMemo, useState } from 'react';
import { RotateCcw, Search, Trash2 } from 'lucide-react';
import { moveTaskToTrash, restoreTask } from '../api/tasks';
import { useAuthStore } from '../store';
import StatusBadge from '../components/shared/StatusBadge';
import VerdictChip from '../components/tasks/VerdictChip';
import DateDisplay from '../components/shared/DateDisplay';
import CopyButton from '../components/shared/CopyButton';
import { useAppStore, useLanguageStore, useToastStore } from '../store';
import type { Task } from '../types';
import { formatNumber } from '../utils/dates';

export default function RecycleBin() {
  const { t, language } = useLanguageStore();
  const {
    trashedTasks,
    members,
    addTask,
    addTrashedTask,
    removeTask,
    removeTrashedTask,
  } = useAppStore();
  const { user } = useAuthStore();
  const { addToast } = useToastStore();
  const [search, setSearch] = useState('');
  const [restoring, setRestoring] = useState('');

  const filteredTasks = useMemo(() => {
    const query = search.trim().toLocaleLowerCase(language === 'fa' ? 'fa' : 'en-US');
    if (!query) return trashedTasks;
    return trashedTasks.filter((task) => {
      const memberName = task.expand?.assigned_to?.name || '';
      return (
        task.task_id.toLocaleLowerCase('en-US').includes(query) ||
        task.body.toLocaleLowerCase(language === 'fa' ? 'fa' : 'en-US').includes(query) ||
        memberName.toLocaleLowerCase(language === 'fa' ? 'fa' : 'en-US').includes(query)
      );
    });
  }, [language, search, trashedTasks]);

  // Restoring is not destructive and it undoes in one click, so it acts
  // immediately instead of stopping to ask. The confirmation modal that used to
  // sit here was pure friction on the safest action in the app.
  const handleRestore = async (task: Task) => {
    if (restoring) return;
    setRestoring(task.id);
    try {
      const restored = await restoreTask(task.id);
      removeTrashedTask(task.id);
      addTask(restored);
      addToast(`${t('recycle_bin.restored')}: ${task.task_id}`, 'success', {
        label: t('common.undo'),
        run: async () => {
          if (!user) return;
          const recycled = await moveTaskToTrash(restored.id, user.id);
          removeTask(recycled.id);
          addTrashedTask(recycled);
        },
      });
    } catch (error) {
      addToast(error instanceof Error ? error.message : t('recycle_bin.restore_error'), 'error');
    } finally {
      setRestoring('');
    }
  };

  return (
    <div className="page recycle-bin-page">
      <div className="page-header recycle-bin-header">
        <div>
          <h1 className="page-title">{t('recycle_bin.title')}</h1>
          <p className="page-subtitle">{t('recycle_bin.subtitle')}</p>
        </div>
        <div className="recycle-bin-retention" role="note">
          <Trash2 size={18} aria-hidden="true" />
          <span>{t('recycle_bin.retention_note')}</span>
        </div>
      </div>

      <div className="data-table-wrapper">
        <div className="data-table-toolbar">
          <div className="data-table-search">
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('recycle_bin.search')}
              aria-label={t('recycle_bin.search')}
            />
          </div>
          <span className="recycle-bin-count">
            {formatNumber(filteredTasks.length, language)} {t('recycle_bin.tasks_retained')}
          </span>
        </div>

        {filteredTasks.length === 0 ? (
          <div className="data-table-empty">
            <div className="data-table-empty-icon">♻️</div>
            <div className="data-table-empty-text">
              {search ? t('recycle_bin.no_results') : t('recycle_bin.empty')}
            </div>
            <p className="recycle-bin-empty-copy">
              {search ? t('recycle_bin.no_results_help') : t('recycle_bin.empty_help')}
            </p>
          </div>
        ) : (
          <table className="data-table recycle-bin-table">
            <thead>
              <tr>
                <th scope="col">{t('tasks.task_id')}</th>
                <th scope="col">{t('tasks.assigned_to')}</th>
                <th scope="col">{t('recycle_bin.saved_status')}</th>
                <th scope="col">{t('recycle_bin.deleted_by')}</th>
                <th scope="col">{t('recycle_bin.deleted_at')}</th>
                <th scope="col">{t('tasks.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {filteredTasks.map((task) => {
                const deletedBy = members.find((member) => member.id === task.deleted_by);
                return (
                  <tr key={task.id}>
                    <td data-label={t('tasks.task_id')}>
                      <div className="task-id-copy">
                        <span className="task-id">{task.task_id}</span>
                        <CopyButton
                          text={task.task_id}
                          compact
                          ariaLabel={`${t('common.copy')}: ${task.task_id}`}
                        />
                      </div>
                    </td>
                    <td data-label={t('tasks.assigned_to')}>
                      <div className="member-cell">
                        <div className="member-avatar">
                          {task.expand?.assigned_to?.name?.charAt(0).toUpperCase() || '?'}
                        </div>
                        <span>{task.expand?.assigned_to?.name || '—'}</span>
                      </div>
                    </td>
                    <td data-label={t('recycle_bin.saved_status')}>
                      <div className="status-cell">
                        <StatusBadge status={task.status} />
                        <VerdictChip task={task} variant="stacked" />
                      </div>
                    </td>
                    <td data-label={t('recycle_bin.deleted_by')}>
                      {deletedBy?.name || '—'}
                    </td>
                    <td data-label={t('recycle_bin.deleted_at')}>
                      {task.deleted_at ? <DateDisplay date={task.deleted_at} /> : '—'}
                    </td>
                    <td data-label={t('tasks.actions')}>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => void handleRestore(task)}
                        disabled={restoring === task.id}
                      >
                        <RotateCcw size={15} aria-hidden="true" />
                        {t('recycle_bin.restore')}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

    </div>
  );
}
