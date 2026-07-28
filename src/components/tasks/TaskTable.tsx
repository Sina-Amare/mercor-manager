import { useState, useMemo } from 'react';
import { Search, Trash2, ArrowRightLeft, Eye, ChevronUp, ChevronDown } from 'lucide-react';
import type { Task, TaskStatus } from '../../types';
import { TASK_STATUSES, STATUS_CONFIG } from '../../types';
import { useAuthStore, useLanguageStore, useAppStore, useToastStore } from '../../store';
import StatusBadge from '../shared/StatusBadge';
import DateDisplay from '../shared/DateDisplay';
import TaskDetailPanel from './TaskDetailPanel';
import { deleteTask, deleteTasks, updateTask as apiUpdateTask } from '../../api/tasks';
import { formatCurrency, usdToIrr } from '../../utils/dates';

interface Props {
  tasks: Task[];
  title: string;
  subtitle?: string;
  showMember?: boolean;
  showActions?: boolean;
  filterByStatus?: TaskStatus;
}

type SortKey = 'task_id' | 'status' | 'assigned_to' | 'created' | 'payment_amount_usd';
type SortDir = 'asc' | 'desc';

export default function TaskTable({
  tasks: inputTasks,
  title,
  subtitle,
  showMember = true,
  showActions = true,
}: Props) {
  const { user } = useAuthStore();
  const { t, language } = useLanguageStore();
  const { selectedTaskIds, toggleTaskSelection, selectAllTasks, clearSelection, setTaskDetail, taskDetailId, removeTask, removeTasks, members, settings, updateTask } = useAppStore();
  const { addToast } = useToastStore();
  const isAdmin = user?.role === 'admin';

  const [search, setSearch] = useState('');
  const [activeStatusFilter, setActiveStatusFilter] = useState<string>('all');
  const [sortKey, setSortKey] = useState<SortKey>('created');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [reassignModalOpen, setReassignModalOpen] = useState(false);
  const [reassignTarget, setReassignTarget] = useState('');

  // Filter & Sort
  const filteredTasks = useMemo(() => {
    let result = inputTasks;

    // Filter by status pill
    if (activeStatusFilter !== 'all') {
      result = result.filter((t) => t.status === activeStatusFilter);
    }

    // Filter by search query
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (t) =>
          t.task_id.toLowerCase().includes(q) ||
          t.body.toLowerCase().includes(q) ||
          t.expand?.assigned_to?.name?.toLowerCase().includes(q)
      );
    }

    result.sort((a, b) => {
      let aVal: string | number = '';
      let bVal: string | number = '';
      switch (sortKey) {
        case 'task_id':
          aVal = a.task_id;
          bVal = b.task_id;
          break;
        case 'status':
          aVal = a.status;
          bVal = b.status;
          break;
        case 'assigned_to':
          aVal = a.expand?.assigned_to?.name || '';
          bVal = b.expand?.assigned_to?.name || '';
          break;
        case 'created':
          aVal = a.created;
          bVal = b.created;
          break;
        case 'payment_amount_usd':
          aVal = a.payment_amount_usd;
          bVal = b.payment_amount_usd;
          break;
      }
      if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return result;
  }, [inputTasks, activeStatusFilter, search, sortKey, sortDir]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return null;
    return sortDir === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />;
  };

  const handleSelectAll = () => {
    if (selectedTaskIds.length === filteredTasks.length) {
      clearSelection();
    } else {
      selectAllTasks(filteredTasks.map((t) => t.id));
    }
  };

  const [deletingTask, setDeletingTask] = useState<Task | null>(null);
  const [showBulkDeleteModal, setShowBulkDeleteModal] = useState(false);

  const confirmDeleteTask = async () => {
    if (!deletingTask) return;
    try {
      await deleteTask(deletingTask.id);
      removeTask(deletingTask.id);
      addToast(`Task ${deletingTask.task_id} deleted successfully`, 'success');
    } catch {
      addToast('Failed to delete task', 'error');
    } finally {
      setDeletingTask(null);
    }
  };

  const confirmBulkDelete = async () => {
    try {
      await deleteTasks(selectedTaskIds);
      removeTasks(selectedTaskIds);
      addToast(`${selectedTaskIds.length} tasks deleted successfully`, 'success');
      clearSelection();
    } catch {
      addToast('Failed to delete tasks', 'error');
    } finally {
      setShowBulkDeleteModal(false);
    }
  };

  const handleBulkReassign = async () => {
    if (!reassignTarget) return;
    try {
      for (const id of selectedTaskIds) {
        await apiUpdateTask(id, { assigned_to: reassignTarget } as Partial<Task>);
        updateTask(id, { assigned_to: reassignTarget });
      }
      clearSelection();
      setReassignModalOpen(false);
      addToast(`${selectedTaskIds.length} tasks reassigned`, 'success');
    } catch {
      addToast('Failed to reassign tasks', 'error');
    }
  };

  const selectedTask = taskDetailId
    ? inputTasks.find((t) => t.id === taskDetailId) || null
    : null;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">{title}</h1>
          {subtitle && <p className="page-subtitle">{subtitle}</p>}
        </div>
      </div>

      {/* Filter Pills Bar */}
      <div className="filter-pills">
        <button
          className={`filter-pill ${activeStatusFilter === 'all' ? 'active' : ''}`}
          onClick={() => setActiveStatusFilter('all')}
        >
          All Tasks ({inputTasks.length})
        </button>
        {TASK_STATUSES.map((statusKey) => {
          const count = inputTasks.filter((t) => t.status === statusKey).length;
          if (count === 0 && !['assigned', 'working', 'swf', 'swof', 'approved'].includes(statusKey)) return null;
          const conf = STATUS_CONFIG[statusKey];
          return (
            <button
              key={statusKey}
              className={`filter-pill ${activeStatusFilter === statusKey ? 'active' : ''}`}
              onClick={() => setActiveStatusFilter(statusKey)}
            >
              {conf.icon} {language === 'fa' ? conf.labelFa : conf.label} ({count})
            </button>
          );
        })}
      </div>

      <div className="data-table-wrapper">
        <div className="data-table-toolbar">
          <div className="data-table-search">
            <Search size={16} style={{ color: 'var(--color-text-tertiary)', flexShrink: 0 }} />
            <input
              type="text"
              placeholder={t('tasks.search')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="data-table-filters">
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', fontWeight: 'var(--weight-medium)' }}>
              Showing {filteredTasks.length} {t('common.of')} {inputTasks.length}
            </span>
          </div>
        </div>

        {filteredTasks.length === 0 ? (
          <div className="data-table-empty">
            <div className="data-table-empty-icon">📋</div>
            <div className="data-table-empty-text">{t('tasks.no_tasks')}</div>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)', marginTop: 'var(--space-2)' }}>
              {t('tasks.no_tasks_desc')}
            </p>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                {isAdmin && showActions && (
                  <th style={{ width: '40px' }}>
                    <input
                      type="checkbox"
                      className="data-table-checkbox"
                      checked={selectedTaskIds.length === filteredTasks.length && filteredTasks.length > 0}
                      onChange={handleSelectAll}
                    />
                  </th>
                )}
                <th onClick={() => handleSort('task_id')}>
                  {t('tasks.task_id')} <SortIcon col="task_id" />
                </th>
                {showMember && (
                  <th onClick={() => handleSort('assigned_to')}>
                    {t('tasks.assigned_to')} <SortIcon col="assigned_to" />
                  </th>
                )}
                <th onClick={() => handleSort('status')}>
                  {t('tasks.status')} <SortIcon col="status" />
                </th>
                <th onClick={() => handleSort('created')}>
                  {t('tasks.created')} <SortIcon col="created" />
                </th>
                <th onClick={() => handleSort('payment_amount_usd')}>
                  {t('tasks.payment')} <SortIcon col="payment_amount_usd" />
                </th>
                {showActions && <th>{t('tasks.actions')}</th>}
              </tr>
            </thead>
            <tbody>
              {filteredTasks.map((task) => (
                <tr
                  key={task.id}
                  className={selectedTaskIds.includes(task.id) ? 'selected' : ''}
                >
                  {isAdmin && showActions && (
                    <td>
                      <input
                        type="checkbox"
                        className="data-table-checkbox"
                        checked={selectedTaskIds.includes(task.id)}
                        onChange={() => toggleTaskSelection(task.id)}
                      />
                    </td>
                  )}
                  <td>
                    <span className="task-id">{task.task_id}</span>
                  </td>
                  {showMember && (
                    <td>
                      <div className="member-cell">
                        <div className="member-avatar">
                          {task.expand?.assigned_to?.name?.charAt(0).toUpperCase() || '?'}
                        </div>
                        {task.expand?.assigned_to?.name || '—'}
                      </div>
                    </td>
                  )}
                  <td>
                    <StatusBadge status={task.status} />
                  </td>
                  <td>
                    <DateDisplay date={task.created} />
                  </td>
                  <td>
                    {task.payment_amount_usd > 0 ? (
                      <div>
                        <span className="payment-amount">
                          {formatCurrency(task.payment_amount_usd, 'USD')}
                        </span>
                        <br />
                        <span className="payment-amount-irr">
                          {formatCurrency(usdToIrr(task.payment_amount_usd, settings.usd_to_irr_rate), 'IRR')}
                        </span>
                      </div>
                    ) : (
                      <span style={{ color: 'var(--color-text-tertiary)' }}>—</span>
                    )}
                  </td>
                  {showActions && (
                    <td>
                      <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
                        <button
                          className="btn btn-ghost btn-icon btn-sm"
                          title={t('tasks.view_detail')}
                          onClick={() => setTaskDetail(task.id)}
                        >
                          <Eye size={16} />
                        </button>
                        {isAdmin && (
                          <button
                            className="btn btn-ghost btn-icon btn-sm"
                            title={t('tasks.delete')}
                            onClick={() => setDeletingTask(task)}
                            style={{ color: 'var(--color-danger)' }}
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Bulk Action Bar */}
      {selectedTaskIds.length > 0 && isAdmin && (
        <div className="bulk-bar">
          <span className="bulk-bar-count">
            {selectedTaskIds.length} {t('tasks.selected')}
          </span>
          <button className="btn btn-danger btn-sm" onClick={() => setShowBulkDeleteModal(true)}>
            <Trash2 size={14} />
            {t('tasks.bulk_delete')}
          </button>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => setReassignModalOpen(true)}
            style={{ background: 'white', color: 'var(--color-text-primary)', border: 'none', fontWeight: 'var(--weight-semibold)' }}
          >
            <ArrowRightLeft size={14} />
            {t('tasks.bulk_reassign')}
          </button>
          <button
            className="btn btn-ghost btn-icon btn-sm"
            onClick={clearSelection}
            style={{ color: '#FFFFFF', opacity: 0.8 }}
            title="Clear Selection"
          >
            ✕
          </button>
        </div>
      )}

      {/* Single Task Delete Confirmation Modal */}
      {deletingTask && (
        <>
          <div className="modal-backdrop" onClick={() => setDeletingTask(null)} />
          <div className="modal">
            <div className="modal-header">
              <h3 className="modal-title" style={{ color: 'var(--color-danger)' }}>Delete Task {deletingTask.task_id}?</h3>
              <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setDeletingTask(null)}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-primary)' }}>
                Are you sure you want to delete task <strong>{deletingTask.task_id}</strong>?
              </p>
              <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', marginTop: 'var(--space-2)' }}>
                This action cannot be undone.
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setDeletingTask(null)}>
                {t('common.cancel')}
              </button>
              <button className="btn btn-danger" onClick={confirmDeleteTask}>
                <Trash2 size={16} />
                Delete Task
              </button>
            </div>
          </div>
        </>
      )}

      {/* Bulk Delete Confirmation Modal */}
      {showBulkDeleteModal && (
        <>
          <div className="modal-backdrop" onClick={() => setShowBulkDeleteModal(false)} />
          <div className="modal">
            <div className="modal-header">
              <h3 className="modal-title" style={{ color: 'var(--color-danger)' }}>Delete {selectedTaskIds.length} Tasks?</h3>
              <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setShowBulkDeleteModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-primary)' }}>
                Are you sure you want to permanently delete <strong>{selectedTaskIds.length} selected tasks</strong>?
              </p>
              <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', marginTop: 'var(--space-2)' }}>
                This action cannot be undone.
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowBulkDeleteModal(false)}>
                {t('common.cancel')}
              </button>
              <button className="btn btn-danger" onClick={confirmBulkDelete}>
                <Trash2 size={16} />
                Delete {selectedTaskIds.length} Tasks
              </button>
            </div>
          </div>
        </>
      )}

      {/* Reassign Modal */}
      {reassignModalOpen && (
        <>
          <div className="modal-backdrop" onClick={() => setReassignModalOpen(false)} />
          <div className="modal">
            <div className="modal-header">
              <h3 className="modal-title">{t('tasks.reassign')}</h3>
              <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setReassignModalOpen(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">{t('upload.assign_label')}</label>
                <select
                  className="form-select"
                  value={reassignTarget}
                  onChange={(e) => setReassignTarget(e.target.value)}
                >
                  <option value="">{t('upload.assign_placeholder')}</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setReassignModalOpen(false)}>
                {t('common.cancel')}
              </button>
              <button
                className="btn btn-primary"
                disabled={!reassignTarget}
                onClick={handleBulkReassign}
              >
                {t('tasks.reassign')} ({selectedTaskIds.length})
              </button>
            </div>
          </div>
        </>
      )}

      {/* Task Detail Panel */}
      {selectedTask && (
        <>
          <div className="modal-backdrop" onClick={() => setTaskDetail(null)} />
          <TaskDetailPanel task={selectedTask} onClose={() => setTaskDetail(null)} />
        </>
      )}
    </div>
  );
}
