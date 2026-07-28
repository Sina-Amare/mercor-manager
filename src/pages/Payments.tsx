import { useState } from 'react';
import { useAuthStore, useLanguageStore, useAppStore, useToastStore } from '../store';
import { formatCurrency, usdToIrr } from '../utils/dates';
import DateDisplay from '../components/shared/DateDisplay';
import StatusBadge from '../components/shared/StatusBadge';
import TaskDetailPanel from '../components/tasks/TaskDetailPanel';
import { updateTask as apiUpdateTask } from '../api/tasks';
import type { Task } from '../types';
import { Edit2, RotateCcw, Eye, Save } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function Payments() {
  const { user } = useAuthStore();
  const { t } = useLanguageStore();
  const { tasks, members, settings, updateTask } = useAppStore();
  const { addToast } = useToastStore();
  const navigate = useNavigate();
  const isAdmin = user?.role === 'admin';

  // For members, show only their tasks
  const relevantTasks = isAdmin ? tasks : tasks.filter((t) => t.assigned_to === user?.id);
  const paidTasks = relevantTasks.filter((t) => t.payment_status === 'paid');
  const pendingTasks = relevantTasks.filter((t) => t.status === 'approved' && t.payment_status !== 'paid');

  const totalPaidUsd = paidTasks.reduce((sum, t) => sum + t.payment_amount_usd, 0);
  const totalPendingUsd = pendingTasks.reduce((sum, t) => sum + t.payment_amount_usd, 0);

  // Detail panel & Edit payment state
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [editUsd, setEditUsd] = useState(0);
  const [saving, setSaving] = useState(false);

  const handleOpenEditModal = (task: Task) => {
    setEditingTask(task);
    setEditUsd(task.payment_amount_usd);
  };

  const handleSavePaymentAmount = async () => {
    if (!editingTask) return;
    setSaving(true);
    try {
      const updated = await apiUpdateTask(editingTask.id, {
        payment_amount_usd: editUsd,
      } as Partial<Task>);
      updateTask(editingTask.id, updated);
      addToast('Payment amount updated successfully', 'success');
      setEditingTask(null);
    } catch {
      addToast('Failed to update payment amount', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleRevertPaymentStatus = async (task: Task) => {
    try {
      const updated = await apiUpdateTask(task.id, {
        payment_status: 'pending',
        payment_date: '',
      } as Partial<Task>);
      updateTask(task.id, updated);
      addToast(`Payment for ${task.task_id} reverted to Pending`, 'success');
    } catch {
      addToast('Failed to revert payment', 'error');
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('payments.title')}</h1>
          <p className="page-subtitle">{t('payments.subtitle')}</p>
        </div>
      </div>

      {/* Summary */}
      <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
        <div className="stat-card">
          <span className="stat-card-label">{t('dashboard.total_paid')}</span>
          <span className="stat-card-value" style={{ color: 'var(--color-success)' }}>
            {formatCurrency(totalPaidUsd, 'USD')}
          </span>
          <span className="payment-amount-irr">
            {formatCurrency(usdToIrr(totalPaidUsd, settings.usd_to_irr_rate), 'IRR')}
          </span>
        </div>
        <div className="stat-card">
          <span className="stat-card-label">{t('dashboard.pending_payment')}</span>
          <span className="stat-card-value" style={{ color: 'var(--color-warning)' }}>
            {formatCurrency(totalPendingUsd, 'USD')}
          </span>
          <span className="payment-amount-irr">
            {formatCurrency(usdToIrr(totalPendingUsd, settings.usd_to_irr_rate), 'IRR')}
          </span>
        </div>
        <div className="stat-card">
          <span className="stat-card-label">{t('payments.tasks_paid')}</span>
          <span className="stat-card-value">{paidTasks.length}</span>
        </div>
        <div className="stat-card">
          <span className="stat-card-label">{t('payments.tasks_pending')}</span>
          <span className="stat-card-value">{pendingTasks.length}</span>
        </div>
      </div>

      {/* Admin: Per-member table */}
      {isAdmin && (
        <div className="data-table-wrapper" style={{ marginTop: 'var(--space-6)' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('payments.member')}</th>
                <th>{t('payments.tasks_approved')}</th>
                <th>{t('payments.tasks_paid')}</th>
                <th>{t('payments.tasks_pending')}</th>
                <th>{t('payments.total_usd')}</th>
                <th>{t('payments.total_irr')}</th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => {
                const mTasks = tasks.filter((t) => t.assigned_to === member.id);
                const mApproved = mTasks.filter((t) => t.status === 'approved').length;
                const mPaid = mTasks.filter((t) => t.payment_status === 'paid');
                const mPending = mTasks.filter((t) => t.status === 'approved' && t.payment_status !== 'paid');
                const mTotalPaid = mPaid.reduce((s, t) => s + t.payment_amount_usd, 0);

                return (
                  <tr key={member.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/member/${member.id}`)}>
                    <td>
                      <div className="member-cell">
                        <div className="member-avatar">{member.name.charAt(0).toUpperCase()}</div>
                        {member.name}
                      </div>
                    </td>
                    <td>{mApproved + mPaid.length}</td>
                    <td style={{ color: 'var(--color-success)', fontWeight: 'var(--weight-semibold)' }}>
                      {mPaid.length}
                    </td>
                    <td style={{ color: 'var(--color-warning)', fontWeight: 'var(--weight-semibold)' }}>
                      {mPending.length}
                    </td>
                    <td>
                      <span className="payment-amount">{formatCurrency(mTotalPaid, 'USD')}</span>
                    </td>
                    <td>
                      <span className="payment-amount-irr">
                        {formatCurrency(usdToIrr(mTotalPaid, settings.usd_to_irr_rate), 'IRR')}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Task payment history */}
      <div style={{ marginTop: 'var(--space-6)' }}>
        <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-semibold)', marginBottom: 'var(--space-4)' }}>
          {t('payments.tasks_paid')}
        </h2>
        <div className="data-table-wrapper">
          {paidTasks.length === 0 ? (
            <div className="data-table-empty">
              <div className="data-table-empty-icon">💰</div>
              <div className="data-table-empty-text">No paid tasks yet</div>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('tasks.task_id')}</th>
                  {isAdmin && <th>{t('tasks.assigned_to')}</th>}
                  <th>{t('tasks.status')}</th>
                  <th>{t('payments.amount_usd')}</th>
                  <th>IRR</th>
                  <th>Payment Date</th>
                  <th>{t('tasks.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {paidTasks.map((task) => (
                  <tr key={task.id}>
                    <td><span className="task-id">{task.task_id}</span></td>
                    {isAdmin && (
                      <td>
                        <div className="member-cell">
                          <div className="member-avatar">
                            {task.expand?.assigned_to?.name?.charAt(0).toUpperCase() || '?'}
                          </div>
                          {task.expand?.assigned_to?.name || '—'}
                        </div>
                      </td>
                    )}
                    <td><StatusBadge status={task.status} /></td>
                    <td><span className="payment-amount">{formatCurrency(task.payment_amount_usd, 'USD')}</span></td>
                    <td>
                      <span className="payment-amount-irr">
                        {formatCurrency(usdToIrr(task.payment_amount_usd, settings.usd_to_irr_rate), 'IRR')}
                      </span>
                    </td>
                    <td><DateDisplay date={task.payment_date || task.updated} /></td>
                    <td>
                      <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
                        <button
                          className="btn btn-ghost btn-icon btn-sm"
                          title="View Details"
                          onClick={() => setSelectedTask(task)}
                        >
                          <Eye size={15} />
                        </button>
                        {isAdmin && (
                          <>
                            <button
                              className="btn btn-ghost btn-icon btn-sm"
                              title="Edit Payment Amount"
                              onClick={() => handleOpenEditModal(task)}
                            >
                              <Edit2 size={15} />
                            </button>
                            <button
                              className="btn btn-ghost btn-icon btn-sm"
                              title="Revert to Pending Payment"
                              onClick={() => handleRevertPaymentStatus(task)}
                              style={{ color: 'var(--color-warning)' }}
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
      </div>

      {/* Edit Payment Modal */}
      {editingTask && (
        <>
          <div className="modal-backdrop" onClick={() => setEditingTask(null)} />
          <div className="modal">
            <div className="modal-header">
              <h3 className="modal-title">Edit Payment: {editingTask.task_id}</h3>
              <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setEditingTask(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">{t('payments.amount_usd')}</label>
                <input
                  type="number"
                  className="form-input input-mono"
                  value={editUsd}
                  onChange={(e) => setEditUsd(Number(e.target.value))}
                  min={0}
                  step={0.01}
                />
                {editUsd > 0 && (
                  <div style={{ marginTop: 'var(--space-2)', fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', fontFamily: 'var(--font-mono)' }}>
                    = {formatCurrency(usdToIrr(editUsd, settings.usd_to_irr_rate), 'IRR')}
                  </div>
                )}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setEditingTask(null)}>
                {t('common.cancel')}
              </button>
              <button className="btn btn-primary" onClick={handleSavePaymentAmount} disabled={saving}>
                <Save size={16} />
                Save Amount
              </button>
            </div>
          </div>
        </>
      )}

      {/* Task Detail Drawer */}
      {selectedTask && (
        <>
          <div className="modal-backdrop" onClick={() => setSelectedTask(null)} />
          <TaskDetailPanel task={selectedTask} onClose={() => setSelectedTask(null)} />
        </>
      )}
    </div>
  );
}
