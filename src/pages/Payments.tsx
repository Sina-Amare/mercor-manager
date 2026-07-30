import { useState } from 'react';
import { Edit2, Eye, RotateCcw, Save } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore, useLanguageStore, useAppStore, useToastStore } from '../store';
import { formatCurrency, formatNumber, usdToIrr } from '../utils/dates';
import DateDisplay from '../components/shared/DateDisplay';
import StatusBadge from '../components/shared/StatusBadge';
import VerdictChip from '../components/tasks/VerdictChip';
import ConfirmDialog from '../components/shared/ConfirmDialog';
import { TaskConflictError, updateTask as apiUpdateTask } from '../api/tasks';
import type { Task } from '../types';

export default function Payments() {
  const { user } = useAuthStore();
  const { t, language } = useLanguageStore();
  const { tasks, members, settings, updateTask, removeTask } = useAppStore();
  const { addToast } = useToastStore();
  const navigate = useNavigate();
  const isAdmin = user?.role === 'admin';
  const teamMembers = members.filter((member) => member.role === 'member' && member.is_active);

  const relevantTasks = isAdmin ? tasks : tasks.filter((task) => task.assigned_to === user?.id);
  const paidTasks = relevantTasks.filter((task) => task.payment_status === 'paid');
  const pendingTasks = relevantTasks.filter(
    (task) => task.status === 'approved' && task.payment_status !== 'paid'
  );

  const totalPaidUsd = paidTasks.reduce((sum, task) => sum + task.payment_amount_usd, 0);
  const totalPendingUsd = pendingTasks.reduce((sum, task) => sum + task.payment_amount_usd, 0);

  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [editUsd, setEditUsd] = useState(0);
  const [revertingTask, setRevertingTask] = useState<Task | null>(null);
  const [saving, setSaving] = useState(false);

  // The same guarded write path the workspace uses. Both payment writes on this
  // page previously went out with no concurrency guard, so two admins editing
  // one amount silently overwrote each other.
  const guardedWrite = async (
    task: Task,
    patch: Partial<Task>,
    messages: { success: string; error: string }
  ) => {
    if (saving) return false;
    setSaving(true);
    try {
      const updated = await apiUpdateTask(task.id, patch, {
        expectedStatus: task.status,
        expectedAssignee: task.assigned_to,
        expectedUpdated: task.updated,
      });
      updateTask(updated.id, updated);
      addToast(messages.success, 'success');
      return true;
    } catch (error) {
      if (error instanceof TaskConflictError) {
        if (error.latestTask) updateTask(error.latestTask.id, error.latestTask);
        else if (error.latestTask === null) removeTask(task.id);
        addToast(t('tasks.conflict'), 'warning');
      } else {
        addToast(error instanceof Error ? error.message : messages.error, 'error');
      }
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAmount = async () => {
    if (!editingTask) return;
    if (!Number.isFinite(editUsd) || editUsd < 0) {
      addToast(t('payments.invalid_amount'), 'error');
      return;
    }
    const ok = await guardedWrite(
      editingTask,
      { payment_amount_usd: editUsd },
      { success: t('payments.amount_saved'), error: t('payments.amount_save_error') }
    );
    if (ok) setEditingTask(null);
  };

  const handleRevert = async () => {
    if (!revertingTask) return;
    const ok = await guardedWrite(
      revertingTask,
      { payment_status: 'pending', payment_date: '' },
      { success: t('payments.reverted_pending'), error: t('payments.revert_error') }
    );
    if (ok) setRevertingTask(null);
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('payments.title')}</h1>
          <p className="page-subtitle">{t('payments.subtitle')}</p>
        </div>
      </div>

      <div className="stats-grid stats-grid-compact">
        <div className="stat-card">
          <span className="stat-card-label">{t('dashboard.total_paid')}</span>
          <span className="stat-card-value stat-card-value-success">
            {formatCurrency(totalPaidUsd, 'USD', language)}
          </span>
          <span className="payment-amount-irr">
            {formatCurrency(usdToIrr(totalPaidUsd, settings.usd_to_irr_rate), 'IRR', language)}
          </span>
        </div>
        <div className="stat-card">
          <span className="stat-card-label">{t('dashboard.pending_payment')}</span>
          <span className="stat-card-value stat-card-value-warning">
            {formatCurrency(totalPendingUsd, 'USD', language)}
          </span>
          <span className="payment-amount-irr">
            {formatCurrency(usdToIrr(totalPendingUsd, settings.usd_to_irr_rate), 'IRR', language)}
          </span>
        </div>
        <div className="stat-card">
          <span className="stat-card-label">{t('payments.tasks_paid')}</span>
          <span className="stat-card-value">{formatNumber(paidTasks.length, language)}</span>
        </div>
        <div className="stat-card">
          <span className="stat-card-label">{t('payments.tasks_pending')}</span>
          <span className="stat-card-value">{formatNumber(pendingTasks.length, language)}</span>
        </div>
      </div>

      {isAdmin && (
        <div className="data-table-wrapper section-gap">
          <table className="data-table">
            <caption className="sr-only">{t('payments.per_member')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('payments.member')}</th>
                <th scope="col">{t('payments.tasks_approved')}</th>
                <th scope="col">{t('payments.tasks_paid')}</th>
                <th scope="col">{t('payments.tasks_pending')}</th>
                <th scope="col">{t('payments.total_usd')}</th>
                <th scope="col">{t('payments.total_irr')}</th>
              </tr>
            </thead>
            <tbody>
              {teamMembers.map((member) => {
                const memberTasks = tasks.filter((task) => task.assigned_to === member.id);
                const approved = memberTasks.filter((task) => task.status === 'approved').length;
                const paid = memberTasks.filter((task) => task.payment_status === 'paid');
                const pending = memberTasks.filter(
                  (task) => task.status === 'approved' && task.payment_status !== 'paid'
                );
                const totalPaid = paid.reduce((sum, task) => sum + task.payment_amount_usd, 0);

                return (
                  <tr
                    key={member.id}
                    className="clickable-row"
                    tabIndex={0}
                    onClick={() => navigate(`/member/${member.id}`)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        navigate(`/member/${member.id}`);
                      }
                    }}
                  >
                    <td data-label={t('payments.member')}>
                      <div className="member-cell">
                        <div className="member-avatar" aria-hidden="true">
                          {member.name.charAt(0).toUpperCase()}
                        </div>
                        {member.name}
                      </div>
                    </td>
                    <td data-label={t('payments.tasks_approved')}>
                      {formatNumber(approved, language)}
                    </td>
                    <td data-label={t('payments.tasks_paid')} className="cell-success">
                      {formatNumber(paid.length, language)}
                    </td>
                    <td data-label={t('payments.tasks_pending')} className="cell-warning">
                      {formatNumber(pending.length, language)}
                    </td>
                    <td data-label={t('payments.total_usd')}>
                      <span className="payment-amount">
                        {formatCurrency(totalPaid, 'USD', language)}
                      </span>
                    </td>
                    <td data-label={t('payments.total_irr')}>
                      <span className="payment-amount-irr">
                        {formatCurrency(
                          usdToIrr(totalPaid, settings.usd_to_irr_rate),
                          'IRR',
                          language
                        )}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <section className="section-gap">
        <h2 className="section-heading">{t('payments.history_heading')}</h2>
        <div className="data-table-wrapper">
          {paidTasks.length === 0 ? (
            <div className="data-table-empty">
              <div className="data-table-empty-icon" aria-hidden="true">
                💰
              </div>
              <div className="data-table-empty-text">{t('payments.no_paid_tasks')}</div>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">{t('tasks.task_id')}</th>
                  {isAdmin && <th scope="col">{t('tasks.assigned_to')}</th>}
                  <th scope="col">{t('tasks.status')}</th>
                  <th scope="col">{t('payments.amount_usd')}</th>
                  <th scope="col">{t('payments.total_irr')}</th>
                  <th scope="col">{t('payments.payment_date')}</th>
                  <th scope="col">{t('tasks.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {paidTasks.map((task) => (
                  <tr key={task.id}>
                    <td data-label={t('tasks.task_id')}>
                      <span className="task-id">{task.task_id}</span>
                    </td>
                    {isAdmin && (
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
                      <div className="status-cell">
                        <StatusBadge status={task.status} />
                        <VerdictChip task={task} variant="stacked" />
                      </div>
                    </td>
                    <td data-label={t('payments.amount_usd')}>
                      <span className="payment-amount">
                        {formatCurrency(task.payment_amount_usd, 'USD', language)}
                      </span>
                    </td>
                    <td data-label={t('payments.total_irr')}>
                      <span className="payment-amount-irr">
                        {formatCurrency(
                          usdToIrr(task.payment_amount_usd, settings.usd_to_irr_rate),
                          'IRR',
                          language
                        )}
                      </span>
                    </td>
                    <td data-label={t('payments.payment_date')}>
                      <DateDisplay date={task.payment_date || task.updated} />
                    </td>
                    <td data-label={t('tasks.actions')}>
                      <div className="row-actions">
                        {/* A task opens in one place: the workspace. This used
                            to open a cramped drawer showing the same content. */}
                        <button
                          className="btn btn-ghost btn-icon btn-sm"
                          title={t('tasks.open_workspace')}
                          aria-label={`${t('tasks.open_workspace')}: ${task.task_id}`}
                          onClick={() => navigate(`/task/${task.id}`)}
                        >
                          <Eye size={15} />
                        </button>
                        {isAdmin && (
                          <>
                            <button
                              className="btn btn-ghost btn-icon btn-sm"
                              title={t('payments.edit_amount')}
                              aria-label={`${t('payments.edit_amount')}: ${task.task_id}`}
                              onClick={() => {
                                setEditingTask(task);
                                setEditUsd(task.payment_amount_usd);
                              }}
                            >
                              <Edit2 size={15} />
                            </button>
                            <button
                              className="btn btn-ghost btn-icon btn-sm btn-icon-warning"
                              title={t('payments.revert_pending')}
                              aria-label={`${t('payments.revert_pending')}: ${task.task_id}`}
                              onClick={() => setRevertingTask(task)}
                            >
                              <RotateCcw size={15} />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <ConfirmDialog
        open={Boolean(revertingTask)}
        title={t('payments.revert_title')}
        tone="warning"
        busy={saving}
        confirmLabel={t('payments.revert_pending')}
        onCancel={() => setRevertingTask(null)}
        onConfirm={() => void handleRevert()}
      >
        <p className="confirm-copy">
          {t('payments.revert_confirm_detail')
            .replace('{task}', revertingTask?.task_id || '')
            .replace(
              '{amount}',
              formatCurrency(revertingTask?.payment_amount_usd || 0, 'USD', language)
            )}
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={Boolean(editingTask)}
        title={`${t('payments.edit_amount')} — ${editingTask?.task_id || ''}`}
        busy={saving}
        confirmLabel={t('common.save')}
        onCancel={() => setEditingTask(null)}
        onConfirm={() => void handleSaveAmount()}
      >
        <div className="form-group">
          <label className="form-label" htmlFor="payment-edit-amount">
            {t('payments.amount_usd')}
          </label>
          <input
            id="payment-edit-amount"
            type="number"
            className="form-input input-mono"
            value={editUsd}
            onChange={(event) => setEditUsd(Number(event.target.value))}
            min={0}
            step={0.01}
            data-autofocus
          />
          {editUsd > 0 && (
            <p className="payment-conversion">
              = {formatCurrency(usdToIrr(editUsd, settings.usd_to_irr_rate), 'IRR', language)}
            </p>
          )}
        </div>
        <p className="confirm-note">
          <Save size={13} aria-hidden="true" />
          {t('payments.edit_amount_note')}
        </p>
      </ConfirmDialog>
    </div>
  );
}
