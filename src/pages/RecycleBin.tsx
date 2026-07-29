import { useMemo, useState } from 'react';
import { RotateCcw, Search, Trash2 } from 'lucide-react';
import { restoreTask } from '../api/tasks';
import StatusBadge from '../components/shared/StatusBadge';
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
    removeTrashedTask,
  } = useAppStore();
  const { addToast } = useToastStore();
  const [search, setSearch] = useState('');
  const [restoringTask, setRestoringTask] = useState<Task | null>(null);
  const [restoring, setRestoring] = useState(false);

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

  const handleRestore = async () => {
    if (!restoringTask || restoring) return;
    setRestoring(true);
    try {
      const restored = await restoreTask(restoringTask.id);
      removeTrashedTask(restoringTask.id);
      addTask(restored);
      addToast(`${t('recycle_bin.restored')}: ${restoringTask.task_id}`, 'success');
      setRestoringTask(null);
    } catch (error) {
      addToast(
        error instanceof Error ? error.message : t('recycle_bin.restore_error'),
        'error'
      );
    } finally {
      setRestoring(false);
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
                <th>{t('tasks.task_id')}</th>
                <th>{t('tasks.assigned_to')}</th>
                <th>{t('recycle_bin.saved_status')}</th>
                <th>{t('recycle_bin.deleted_by')}</th>
                <th>{t('recycle_bin.deleted_at')}</th>
                <th>{t('tasks.actions')}</th>
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
                      <StatusBadge status={task.status} />
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
                        onClick={() => setRestoringTask(task)}
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

      {restoringTask ? (
        <>
          <div className="modal-backdrop" onClick={() => setRestoringTask(null)} />
          <div className="modal" role="dialog" aria-modal="true">
            <div className="modal-header">
              <h3 className="modal-title">{t('recycle_bin.restore_title')}</h3>
              <button
                className="btn btn-ghost btn-icon btn-sm"
                onClick={() => setRestoringTask(null)}
                aria-label={t('common.close')}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <p className="recycle-bin-restore-copy">
                {t('recycle_bin.restore_confirm')}{' '}
                <strong className="input-mono">{restoringTask.task_id}</strong>?
              </p>
              <div className="recycle-bin-restore-summary">
                <span>{t('recycle_bin.restore_help')}</span>
                <StatusBadge status={restoringTask.status} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setRestoringTask(null)}>
                {t('common.cancel')}
              </button>
              <button className="btn btn-primary" onClick={handleRestore} disabled={restoring}>
                <RotateCcw size={16} aria-hidden="true" />
                {t('recycle_bin.restore')}
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
