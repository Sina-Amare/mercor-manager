import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRightLeft,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Search,
  Trash2,
  Workflow,
  X,
} from 'lucide-react';
import type { Task, TaskStatus } from '../../types';
import { TASK_STATUSES, STATUS_CONFIG } from '../../types';
import { useAuthStore, useLanguageStore, useAppStore, useToastStore } from '../../store';
import StatusBadge from '../shared/StatusBadge';
import DateDisplay from '../shared/DateDisplay';
import CopyButton from '../shared/CopyButton';
import ConfirmDialog from '../shared/ConfirmDialog';
import {
  availableTransitions,
  transitionEffects,
  type Transition,
} from '../../workflow';
import {
  moveTaskToTrash,
  moveTasksToTrash,
  restoreTask,
  updateTasks as apiUpdateTasks,
} from '../../api/tasks';
import { daysSince, formatCurrency, formatNumber, formatRelativeTime, usdToIrr } from '../../utils/dates';

interface Props {
  tasks: Task[];
  title: string;
  subtitle?: string;
  showMember?: boolean;
  showActions?: boolean;
}

type SortKey = 'task_id' | 'status' | 'assigned_to' | 'created' | 'updated' | 'payment_amount_usd';
type SortDir = 'asc' | 'desc';

const PAGE_SIZE = 200;
// A task nobody has touched for this long is worth pointing at.
const STALE_DAYS = 7;

export default function TaskTable({
  tasks: inputTasks,
  title,
  subtitle,
  showMember = true,
  showActions = true,
}: Props) {
  const { user } = useAuthStore();
  const { t, language } = useLanguageStore();
  const {
    selectedTaskIds,
    toggleTaskSelection,
    selectAllTasks,
    clearSelection,
    removeTask,
    removeTasks,
    addTask,
    addTrashedTask,
    removeTrashedTask,
    members,
    settings,
    updateTask,
  } = useAppStore();
  const { addToast } = useToastStore();
  const isAdmin = user?.role === 'admin';
  const navigate = useNavigate();

  const [search, setSearch] = useState('');
  const [activeStatusFilter, setActiveStatusFilter] = useState<'all' | TaskStatus>('all');
  const [sortKey, setSortKey] = useState<SortKey>('updated');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);

  const [deletingTask, setDeletingTask] = useState<Task | null>(null);
  const [bulkDelete, setBulkDelete] = useState(false);
  const [reassignTarget, setReassignTarget] = useState('');
  const [reassignOpen, setReassignOpen] = useState(false);
  const [bulkTransition, setBulkTransition] = useState<Transition | null>(null);

  const inputTaskIds = useMemo(() => new Set(inputTasks.map((task) => task.id)), [inputTasks]);
  const activeSelectedTaskIds = selectedTaskIds.filter((id) => inputTaskIds.has(id));
  const selectedTasks = inputTasks.filter((task) => activeSelectedTaskIds.includes(task.id));

  useEffect(() => () => clearSelection(), [clearSelection]);
  useEffect(() => setPage(0), [search, activeStatusFilter, sortKey, sortDir]);

  const filteredTasks = useMemo(() => {
    let result = [...inputTasks];

    if (activeStatusFilter !== 'all') {
      result = result.filter((task) => task.status === activeStatusFilter);
    }

    if (search.trim()) {
      const query = search.trim().toLowerCase();
      result = result.filter(
        (task) =>
          task.task_id.toLowerCase().includes(query) ||
          task.body.toLowerCase().includes(query) ||
          task.submission_prompt.toLowerCase().includes(query) ||
          task.submission_final_answer.toLowerCase().includes(query) ||
          task.expand?.assigned_to?.name?.toLowerCase().includes(query)
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
          // Workflow order, not alphabetical — sorting by the raw key used to
          // put "admin_discarded" first and "working" near the end.
          aVal = TASK_STATUSES.indexOf(a.status);
          bVal = TASK_STATUSES.indexOf(b.status);
          break;
        case 'assigned_to':
          aVal = a.expand?.assigned_to?.name || '';
          bVal = b.expand?.assigned_to?.name || '';
          break;
        case 'created':
          aVal = a.created;
          bVal = b.created;
          break;
        case 'updated':
          aVal = a.updated;
          bVal = b.updated;
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

  const pageCount = Math.max(1, Math.ceil(filteredTasks.length / PAGE_SIZE));
  const visibleTasks = filteredTasks.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'created' || key === 'updated' ? 'desc' : 'asc');
    }
  };

  const sortState = (key: SortKey): 'ascending' | 'descending' | 'none' =>
    sortKey !== key ? 'none' : sortDir === 'asc' ? 'ascending' : 'descending';

  const SortHeader = ({ column, label }: { column: SortKey; label: string }) => (
    <th scope="col" aria-sort={sortState(column)}>
      <button type="button" className="data-table-sort" onClick={() => handleSort(column)}>
        {label}
        {sortKey === column &&
          (sortDir === 'asc' ? <ChevronUp size={13} /> : <ChevronDown size={13} />)}
      </button>
    </th>
  );

  const allVisibleSelected =
    visibleTasks.length > 0 && visibleTasks.every((task) => activeSelectedTaskIds.includes(task.id));

  const handleSelectAll = () => {
    if (allVisibleSelected) clearSelection();
    else selectAllTasks(visibleTasks.map((task) => task.id));
  };

  // ── Recycling, with the reversal offered right on the toast ────────────────
  const confirmDeleteTask = async () => {
    if (!deletingTask || busy || !user) return;
    setBusy(true);
    try {
      const recycled = await moveTaskToTrash(deletingTask.id, user.id);
      addTrashedTask(recycled);
      removeTask(deletingTask.id);
      addToast(`${t('tasks.recycled')} ${deletingTask.task_id}`, 'success', {
        label: t('common.undo'),
        run: async () => {
          const restored = await restoreTask(recycled.id);
          removeTrashedTask(restored.id);
          addTask(restored);
        },
      });
    } catch (error) {
      addToast(error instanceof Error ? error.message : t('tasks.recycle_error'), 'error');
    } finally {
      setBusy(false);
      setDeletingTask(null);
    }
  };

  const confirmBulkDelete = async () => {
    const ids = [...activeSelectedTaskIds];
    if (ids.length === 0 || busy || !user) return;
    setBusy(true);
    try {
      const recycled = await moveTasksToTrash(ids, user.id);
      recycled.forEach(addTrashedTask);
      removeTasks(ids);
      addToast(
        `${formatNumber(recycled.length, language)} ${t('tasks.bulk_recycled')}`,
        'success',
        {
          label: t('common.undo'),
          run: async () => {
            for (const task of recycled) {
              const restored = await restoreTask(task.id);
              removeTrashedTask(restored.id);
              addTask(restored);
            }
          },
        }
      );
      clearSelection();
    } catch (error) {
      addToast(error instanceof Error ? error.message : t('tasks.recycle_error'), 'error');
    } finally {
      setBusy(false);
      setBulkDelete(false);
    }
  };

  const handleBulkReassign = async () => {
    const ids = [...activeSelectedTaskIds];
    if (!reassignTarget || ids.length === 0 || busy) return;
    setBusy(true);
    try {
      const updated = await apiUpdateTasks(ids, { assigned_to: reassignTarget });
      updated.forEach((task) => updateTask(task.id, task));
      clearSelection();
      setReassignOpen(false);
      setReassignTarget('');
      addToast(
        t('tasks.bulk_reassigned').replace('{count}', formatNumber(updated.length, language)),
        'success'
      );
    } catch (error) {
      addToast(error instanceof Error ? error.message : t('tasks.reassign_error'), 'error');
    } finally {
      setBusy(false);
    }
  };

  // Only transitions that are legal for *every* selected task are offered, so a
  // bulk move can never produce a state the workflow would refuse.
  const sharedTransitions = useMemo(() => {
    if (selectedTasks.length === 0) return [];
    const lists = selectedTasks.map((task) =>
      availableTransitions(task, user).filter((item) => item.kind !== 'sideways')
    );
    return lists[0].filter((candidate) =>
      lists.every((list) => list.some((item) => item.to === candidate.to))
    );
  }, [selectedTasks, user]);

  const runBulkTransition = async () => {
    if (!bulkTransition || busy) return;
    setBusy(true);
    try {
      // Each task gets its own effects, since verdict and payment side-effects
      // depend on where that task is coming from.
      const results = await Promise.all(
        selectedTasks.map((task) =>
          apiUpdateTasks([task.id], transitionEffects(task, bulkTransition.to))
        )
      );
      results.flat().forEach((task) => updateTask(task.id, task));
      addToast(
        `${t('tasks.status_updated')} ${t(`status.${bulkTransition.to}`)}`,
        'success'
      );
      clearSelection();
    } catch (error) {
      addToast(error instanceof Error ? error.message : t('tasks.status_update_error'), 'error');
    } finally {
      setBusy(false);
      setBulkTransition(null);
    }
  };

  const reassignTargetName = members.find((member) => member.id === reassignTarget)?.name || '';

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">{title}</h1>
          {subtitle && <p className="page-subtitle">{subtitle}</p>}
        </div>
      </div>

      {/* Every status is always listed, greyed when empty. Hiding the empty ones
          made the bar reflow as work moved and left no way to ask "is anything
          on hold?" and get a straight answer. */}
      <div className="filter-pills" role="group" aria-label={t('tasks.filter_by_status')}>
        <button
          className={`filter-pill ${activeStatusFilter === 'all' ? 'active' : ''}`}
          onClick={() => setActiveStatusFilter('all')}
          aria-pressed={activeStatusFilter === 'all'}
        >
          {t('nav.all_tasks')} ({formatNumber(inputTasks.length, language)})
        </button>
        {TASK_STATUSES.map((statusKey) => {
          const count = inputTasks.filter((task) => task.status === statusKey).length;
          return (
            <button
              key={statusKey}
              className={`filter-pill ${activeStatusFilter === statusKey ? 'active' : ''} ${
                count === 0 ? 'is-empty' : ''
              }`}
              onClick={() => setActiveStatusFilter(statusKey)}
              aria-pressed={activeStatusFilter === statusKey}
            >
              <span aria-hidden="true">{STATUS_CONFIG[statusKey].icon}</span>
              {t(`status.${statusKey}`)} ({formatNumber(count, language)})
            </button>
          );
        })}
      </div>

      <div className="data-table-wrapper">
        <div className="data-table-toolbar">
          <div className="data-table-search">
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              placeholder={t('tasks.search')}
              aria-label={t('tasks.search')}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <span className="data-table-count">
            {t('common.showing')} {formatNumber(visibleTasks.length, language)} {t('common.of')}{' '}
            {formatNumber(filteredTasks.length, language)}
          </span>
        </div>

        {filteredTasks.length === 0 ? (
          <div className="data-table-empty">
            <div className="data-table-empty-icon" aria-hidden="true">
              📋
            </div>
            <div className="data-table-empty-text">{t('tasks.no_tasks')}</div>
            <p className="data-table-empty-help">{t('tasks.no_tasks_desc')}</p>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                {isAdmin && showActions && (
                  <th scope="col" className="cell-check">
                    <input
                      type="checkbox"
                      className="data-table-checkbox"
                      checked={allVisibleSelected}
                      onChange={handleSelectAll}
                      aria-label={t('tasks.select_all')}
                    />
                  </th>
                )}
                <SortHeader column="task_id" label={t('tasks.task_id')} />
                {showMember && <SortHeader column="assigned_to" label={t('tasks.assigned_to')} />}
                <SortHeader column="status" label={t('tasks.status')} />
                <SortHeader column="updated" label={t('tasks.last_activity')} />
                <SortHeader column="created" label={t('tasks.created')} />
                <SortHeader column="payment_amount_usd" label={t('tasks.payment')} />
                {isAdmin && showActions && <th scope="col">{t('tasks.actions')}</th>}
              </tr>
            </thead>
            <tbody>
              {visibleTasks.map((task) => {
                const idle = daysSince(task.updated);
                return (
                  <tr
                    key={task.id}
                    className={activeSelectedTaskIds.includes(task.id) ? 'selected' : ''}
                    onClick={(event) => {
                      if (!(event.target as HTMLElement).closest('button, input, a, select')) {
                        navigate(`/task/${task.id}`);
                      }
                    }}
                  >
                    {isAdmin && showActions && (
                      <td className="cell-check">
                        <input
                          type="checkbox"
                          className="data-table-checkbox"
                          checked={activeSelectedTaskIds.includes(task.id)}
                          onChange={() => toggleTaskSelection(task.id)}
                          aria-label={`${t('tasks.select')}: ${task.task_id}`}
                        />
                      </td>
                    )}
                    <td data-label={t('tasks.task_id')}>
                      <div className="task-id-copy">
                        {/* A real link, so the row is reachable and announced by
                            keyboard and screen readers instead of relying on a
                            click handler bolted to the <tr>. */}
                        <Link to={`/task/${task.id}`} className="task-id task-id-link">
                          {task.task_id}
                        </Link>
                        <CopyButton
                          text={task.task_id}
                          compact
                          ariaLabel={`${t('common.copy')}: ${task.task_id}`}
                        />
                      </div>
                    </td>
                    {showMember && (
                      <td data-label={t('tasks.assigned_to')}>
                        <div className="member-cell">
                          <div className="member-avatar" aria-hidden="true">
                            {task.expand?.assigned_to?.name?.charAt(0).toUpperCase() || '?'}
                          </div>
                          {task.expand?.assigned_to?.name || '—'}
                        </div>
                      </td>
                    )}
                    <td data-label={t('tasks.status')}>
                      <StatusBadge status={task.status} />
                    </td>
                    <td data-label={t('tasks.last_activity')}>
                      <span className={`task-age ${idle >= STALE_DAYS ? 'is-stale' : ''}`}>
                        {formatRelativeTime(task.updated, language)}
                      </span>
                    </td>
                    <td data-label={t('tasks.created')}>
                      <DateDisplay date={task.created} />
                    </td>
                    <td data-label={t('tasks.payment')}>
                      {task.payment_amount_usd > 0 ? (
                        <>
                          <span className="payment-amount">
                            {formatCurrency(task.payment_amount_usd, 'USD', language)}
                          </span>
                          <span className="payment-amount-irr">
                            {formatCurrency(
                              usdToIrr(task.payment_amount_usd, settings.usd_to_irr_rate),
                              'IRR',
                              language
                            )}
                          </span>
                        </>
                      ) : (
                        <span className="cell-muted">—</span>
                      )}
                    </td>
                    {isAdmin && showActions && (
                      <td data-label={t('tasks.actions')}>
                        {/* The old "Open" button is gone — the whole row and the
                            task ID link already open the workspace. */}
                        <button
                          className="btn btn-ghost btn-icon btn-sm btn-ghost-danger"
                          title={t('tasks.move_to_recycle_bin')}
                          aria-label={`${t('tasks.move_to_recycle_bin')}: ${task.task_id}`}
                          onClick={() => setDeletingTask(task)}
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {pageCount > 1 && (
          <nav className="data-table-pagination" aria-label={t('common.pagination')}>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setPage((current) => Math.max(0, current - 1))}
              disabled={page === 0}
            >
              <ChevronLeft size={14} className="pagination-icon" />
              {t('common.previous')}
            </button>
            <span>
              {formatNumber(page + 1, language)} / {formatNumber(pageCount, language)}
            </span>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}
              disabled={page >= pageCount - 1}
            >
              {t('common.next')}
              <ChevronRight size={14} className="pagination-icon" />
            </button>
          </nav>
        )}
      </div>

      {activeSelectedTaskIds.length > 0 && isAdmin && (
        <div className="bulk-bar" role="region" aria-label={t('tasks.bulk_actions')}>
          <span className="bulk-bar-count">
            {formatNumber(activeSelectedTaskIds.length, language)} {t('tasks.selected')}
          </span>

          {sharedTransitions.length > 0 && (
            <div className="bulk-bar-group">
              <Workflow size={14} aria-hidden="true" />
              {sharedTransitions.map((transition) => (
                <button
                  key={transition.to}
                  className="btn btn-secondary btn-sm"
                  onClick={() => setBulkTransition(transition)}
                >
                  {t(transition.labelKey)}
                </button>
              ))}
            </div>
          )}

          <button className="btn btn-secondary btn-sm" onClick={() => setReassignOpen(true)}>
            <ArrowRightLeft size={14} />
            {t('tasks.bulk_reassign')}
          </button>
          <button className="btn btn-danger btn-sm" onClick={() => setBulkDelete(true)}>
            <Trash2 size={14} />
            {t('tasks.move_to_recycle_bin')}
          </button>
          <button
            className="btn btn-ghost btn-icon btn-sm bulk-bar-clear"
            onClick={clearSelection}
            aria-label={t('tasks.clear_selection')}
            title={t('tasks.clear_selection')}
          >
            <X size={14} />
          </button>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deletingTask)}
        title={t('tasks.recycle_confirm_title')}
        tone="danger"
        busy={busy}
        confirmLabel={t('tasks.move_to_recycle_bin')}
        onCancel={() => setDeletingTask(null)}
        onConfirm={() => void confirmDeleteTask()}
      >
        <p className="confirm-copy">
          {t('tasks.recycle_confirm')} <strong>{deletingTask?.task_id}</strong>
        </p>
        <p className="confirm-note">{t('tasks.recycle_help')}</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={bulkDelete}
        title={t('tasks.bulk_recycle_confirm_title')}
        tone="danger"
        busy={busy}
        confirmLabel={`${t('tasks.move_to_recycle_bin')} (${formatNumber(
          activeSelectedTaskIds.length,
          language
        )})`}
        onCancel={() => setBulkDelete(false)}
        onConfirm={() => void confirmBulkDelete()}
      >
        <p className="confirm-copy">
          {t('tasks.bulk_recycle_confirm')}{' '}
          <strong>{formatNumber(activeSelectedTaskIds.length, language)}</strong>
        </p>
        <p className="confirm-note">{t('tasks.recycle_help')}</p>
      </ConfirmDialog>

      {/* Reassignment moves work between people, so it confirms — including the
          single-task case in the workspace, which used to fire on change. */}
      <ConfirmDialog
        open={reassignOpen}
        title={t('tasks.reassign')}
        tone="warning"
        busy={busy}
        confirmLabel={`${t('tasks.reassign')} (${formatNumber(
          activeSelectedTaskIds.length,
          language
        )})`}
        onCancel={() => setReassignOpen(false)}
        onConfirm={() => void handleBulkReassign()}
      >
        <div className="form-group">
          <label className="form-label" htmlFor="bulk-reassign-target">
            {t('upload.assign_label')}
          </label>
          <select
            id="bulk-reassign-target"
            className="form-select"
            value={reassignTarget}
            onChange={(event) => setReassignTarget(event.target.value)}
            data-autofocus
          >
            <option value="">{t('upload.assign_placeholder')}</option>
            {members
              .filter((member) => member.role === 'member' && member.is_active)
              .map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
          </select>
        </div>
        {reassignTarget && (
          <p className="confirm-note">
            {t('tasks.bulk_reassign_confirm')
              .replace('{count}', formatNumber(activeSelectedTaskIds.length, language))
              .replace('{to}', reassignTargetName)}
          </p>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={Boolean(bulkTransition)}
        title={bulkTransition ? t(bulkTransition.labelKey) : ''}
        tone={bulkTransition?.confirm === 'destructive' ? 'danger' : 'default'}
        busy={busy}
        confirmLabel={bulkTransition ? t(bulkTransition.labelKey) : t('common.confirm')}
        onCancel={() => setBulkTransition(null)}
        onConfirm={() => void runBulkTransition()}
      >
        <p className="confirm-copy">
          {t('tasks.bulk_status_confirm')
            .replace('{count}', formatNumber(activeSelectedTaskIds.length, language))
            .replace('{status}', bulkTransition ? t(`status.${bulkTransition.to}`) : '')}
        </p>
      </ConfirmDialog>
    </div>
  );
}
