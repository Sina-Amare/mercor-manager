import { useEffect, useState, useMemo } from 'react';
import { Search, Trash2, ArrowRightLeft, Eye, ChevronUp, ChevronDown } from 'lucide-react';
import type { Task, TaskStatus } from '../../types';
import { TASK_STATUSES, STATUS_CONFIG } from '../../types';
import { useAuthStore, useLanguageStore, useAppStore, useToastStore } from '../../store';
import StatusBadge from '../shared/StatusBadge';
import DateDisplay from '../shared/DateDisplay';
import CopyButton from '../shared/CopyButton';
import {
  moveTaskToTrash,
  moveTasksToTrash,
  updateTasks as apiUpdateTasks,
} from '../../api/tasks';
import { formatCurrency, formatNumber, usdToIrr } from '../../utils/dates';
import { useNavigate } from 'react-router-dom';

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
  const { selectedTaskIds, toggleTaskSelection, selectAllTasks, clearSelection, removeTask, removeTasks, addTrashedTask, members, settings, updateTask } = useAppStore();
  const { addToast } = useToastStore();
  const isAdmin = user?.role === 'admin';
  const navigate = useNavigate();

  const [search, setSearch] = useState('');
  const [activeStatusFilter, setActiveStatusFilter] = useState<string>('all');
  const [sortKey, setSortKey] = useState<SortKey>('created');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [reassignModalOpen, setReassignModalOpen] = useState(false);
  const [reassignTarget, setReassignTarget] = useState('');
  const inputTaskIds = useMemo(() => new Set(inputTasks.map((task) => task.id)), [inputTasks]);
  const activeSelectedTaskIds = selectedTaskIds.filter((id) => inputTaskIds.has(id));

  useEffect(() => () => clearSelection(), [clearSelection]);

  // Filter & Sort
  const filteredTasks = useMemo(() => {
    let result = [...inputTasks];

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
    const allFilteredSelected =
      filteredTasks.length > 0 &&
      filteredTasks.every((task) => activeSelectedTaskIds.includes(task.id));
    if (allFilteredSelected) {
      clearSelection();
    } else {
      selectAllTasks(filteredTasks.map((t) => t.id));
    }
  };

  const [deletingTask, setDeletingTask] = useState<Task | null>(null);
  const [showBulkDeleteModal, setShowBulkDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [reassigning, setReassigning] = useState(false);

  const confirmDeleteTask = async () => {
    if (!deletingTask || deleting || !user) return;
    setDeleting(true);
    try {
      const recycled = await moveTaskToTrash(deletingTask.id, user.id);
      addTrashedTask(recycled);
      removeTask(deletingTask.id);
      addToast(`${t('tasks.recycled')} ${deletingTask.task_id}`, 'success');
    } catch (error) {
      addToast(
        error instanceof Error ? error.message : t('tasks.recycle_error'),
        'error'
      );
    } finally {
      setDeleting(false);
      setDeletingTask(null);
    }
  };

  const confirmBulkDelete = async () => {
    const idsToDelete = [...activeSelectedTaskIds];
    if (idsToDelete.length === 0 || deleting || !user) return;
    setDeleting(true);
    try {
      const recycledTasks = await moveTasksToTrash(idsToDelete, user.id);
      recycledTasks.forEach(addTrashedTask);
      removeTasks(idsToDelete);
      addToast(
        `${formatNumber(recycledTasks.length, language)} ${t('tasks.bulk_recycled')}`,
        'success'
      );
      clearSelection();
    } catch (error) {
      addToast(
        error instanceof Error ? error.message : t('tasks.recycle_error'),
        'error'
      );
    } finally {
      setDeleting(false);
      setShowBulkDeleteModal(false);
    }
  };

  const handleBulkReassign = async () => {
    const idsToReassign = [...activeSelectedTaskIds];
    if (!reassignTarget || idsToReassign.length === 0 || reassigning) return;
    setReassigning(true);
    try {
      const updatedTasks = await apiUpdateTasks(
        idsToReassign,
        { assigned_to: reassignTarget } as Partial<Task>
      );
      updatedTasks.forEach((task) => updateTask(task.id, task));
      clearSelection();
      setReassignModalOpen(false);
      setReassignTarget('');
      addToast(`${idsToReassign.length} tasks reassigned`, 'success');
    } catch {
      addToast('Failed to reassign tasks', 'error');
    } finally {
      setReassigning(false);
    }
  };

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
          {t('nav.all_tasks')} ({formatNumber(inputTasks.length, language)})
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
              {conf.icon} {language === 'fa' ? conf.labelFa : conf.label} ({formatNumber(count, language)})
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
              {t('common.showing')} {formatNumber(filteredTasks.length, language)} {t('common.of')}{' '}
              {formatNumber(inputTasks.length, language)}
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
                      checked={
                        filteredTasks.length > 0 &&
                        filteredTasks.every((task) => activeSelectedTaskIds.includes(task.id))
                      }
                      onChange={handleSelectAll}
                      aria-label={t('tasks.select_all')}
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
                  className={`${activeSelectedTaskIds.includes(task.id) ? 'selected' : ''} clickable-row`}
                  tabIndex={0}
                  onClick={(event) => {
                    if (
                      !(event.target as HTMLElement).closest('button, input, a, select')
                    ) {
                      navigate(`/task/${task.id}`);
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      navigate(`/task/${task.id}`);
                    }
                  }}
                >
                  {isAdmin && showActions && (
                    <td>
                      <input
                        type="checkbox"
                        className="data-table-checkbox"
                        checked={activeSelectedTaskIds.includes(task.id)}
                        onChange={() => toggleTaskSelection(task.id)}
                        aria-label={`${t('tasks.select_all')}: ${task.task_id}`}
                      />
                    </td>
                  )}
                  <td>
                    <div className="task-id-copy">
                      <span className="task-id">{task.task_id}</span>
                      <CopyButton
                        text={task.task_id}
                        compact
                        ariaLabel={`${t('common.copy')}: ${task.task_id}`}
                      />
                    </div>
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
                          {formatCurrency(task.payment_amount_usd, 'USD', language)}
                        </span>
                        <br />
                        <span className="payment-amount-irr">
                          {formatCurrency(usdToIrr(task.payment_amount_usd, settings.usd_to_irr_rate), 'IRR', language)}
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
                          className="btn btn-secondary btn-sm"
                          title={t('tasks.open_workspace')}
                          onClick={() => navigate(`/task/${task.id}`)}
                        >
                          <Eye size={16} />
                          {t('tasks.open')}
                        </button>
                        {isAdmin && (
                          <button
                            className="btn btn-ghost btn-icon btn-sm"
                            title={t('tasks.move_to_recycle_bin')}
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
      {activeSelectedTaskIds.length > 0 && isAdmin && (
        <div className="bulk-bar">
          <span className="bulk-bar-count">
            {formatNumber(activeSelectedTaskIds.length, language)} {t('tasks.selected')}
          </span>
          <button className="btn btn-danger btn-sm" onClick={() => setShowBulkDeleteModal(true)}>
            <Trash2 size={14} />
            {t('tasks.move_to_recycle_bin')}
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

      {/* Single Task Recycle Confirmation Modal */}
      {deletingTask && (
        <>
          <div className="modal-backdrop" onClick={() => setDeletingTask(null)} />
          <div className="modal" role="dialog" aria-modal="true">
            <div className="modal-header">
              <h3 className="modal-title">{t('tasks.recycle_confirm_title')}</h3>
              <button
                className="btn btn-ghost btn-icon btn-sm"
                onClick={() => setDeletingTask(null)}
                aria-label={t('common.close')}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-primary)' }}>
                {t('tasks.recycle_confirm')} <strong>{deletingTask.task_id}</strong>?
              </p>
              <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', marginTop: 'var(--space-2)' }}>
                {t('tasks.recycle_help')}
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setDeletingTask(null)}>
                {t('common.cancel')}
              </button>
              <button className="btn btn-danger" onClick={confirmDeleteTask} disabled={deleting}>
                <Trash2 size={16} />
                {t('tasks.move_to_recycle_bin')}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Bulk Recycle Confirmation Modal */}
      {showBulkDeleteModal && (
        <>
          <div className="modal-backdrop" onClick={() => setShowBulkDeleteModal(false)} />
          <div className="modal" role="dialog" aria-modal="true">
            <div className="modal-header">
              <h3 className="modal-title">{t('tasks.bulk_recycle_confirm_title')}</h3>
              <button
                className="btn btn-ghost btn-icon btn-sm"
                onClick={() => setShowBulkDeleteModal(false)}
                aria-label={t('common.close')}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-primary)' }}>
                {t('tasks.bulk_recycle_confirm')}{' '}
                <strong>{formatNumber(activeSelectedTaskIds.length, language)}</strong>?
              </p>
              <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', marginTop: 'var(--space-2)' }}>
                {t('tasks.recycle_help')}
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowBulkDeleteModal(false)}>
                {t('common.cancel')}
              </button>
              <button className="btn btn-danger" onClick={confirmBulkDelete} disabled={deleting}>
                <Trash2 size={16} />
                {t('tasks.move_to_recycle_bin')} ({formatNumber(activeSelectedTaskIds.length, language)})
              </button>
            </div>
          </div>
        </>
      )}

      {/* Reassign Modal */}
      {reassignModalOpen && (
        <>
          <div className="modal-backdrop" onClick={() => setReassignModalOpen(false)} />
          <div className="modal" role="dialog" aria-modal="true">
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
                  {members
                    .filter((member) => member.role === 'member' && member.is_active)
                    .map((m) => (
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
                disabled={!reassignTarget || reassigning}
                onClick={handleBulkReassign}
              >
                {t('tasks.reassign')} ({activeSelectedTaskIds.length})
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
