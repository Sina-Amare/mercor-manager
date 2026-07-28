import { useState } from 'react';
import { X, Save } from 'lucide-react';
import type { Task, TaskStatus } from '../../types';
import { useAuthStore, useLanguageStore, useAppStore, useToastStore } from '../../store';
import StatusBadge from '../shared/StatusBadge';
import DateDisplay from '../shared/DateDisplay';
import { updateTask as apiUpdateTask } from '../../api/tasks';
import { formatCurrency, usdToIrr } from '../../utils/dates';

interface Props {
  task: Task;
  onClose: () => void;
}

export default function TaskDetailPanel({ task, onClose }: Props) {
  const { user } = useAuthStore();
  const { t } = useLanguageStore();
  const { updateTask, settings, members } = useAppStore();
  const { addToast } = useToastStore();
  const isAdmin = user?.role === 'admin';
  const isMember = user?.role === 'member';
  const isMyTask = task.assigned_to === user?.id;

  const [notes, setNotes] = useState(task.admin_notes || '');
  const [paymentUsd, setPaymentUsd] = useState(task.payment_amount_usd || 0);
  const [saving, setSaving] = useState(false);

  const handleStatusChange = async (newStatus: TaskStatus, extraData?: Partial<Task>) => {
    setSaving(true);
    try {
      const data: Partial<Task> = { status: newStatus, ...extraData };
      if (['swf', 'swof', 'member_discarded'].includes(newStatus)) {
        data.member_verdict = newStatus as Task['member_verdict'];
        data.member_verdict_date = new Date().toISOString();
      }
      if (['approved', 'sent_back', 'admin_discarded'].includes(newStatus)) {
        data.admin_verdict = newStatus === 'approved'
          ? 'approved'
          : newStatus === 'sent_back'
          ? 'sent_back'
          : 'admin_discarded';
        data.admin_verdict_date = new Date().toISOString();
      }
      if (newStatus === 'approved') {
        data.payment_status = 'pending';
      }
      const updated = await apiUpdateTask(task.id, data);
      updateTask(task.id, updated);
      addToast(`Task status updated to ${newStatus}`, 'success');
    } catch {
      addToast('Failed to update task', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveNotes = async () => {
    setSaving(true);
    try {
      await apiUpdateTask(task.id, { admin_notes: notes } as Partial<Task>);
      updateTask(task.id, { admin_notes: notes });
      addToast('Notes saved', 'success');
    } catch {
      addToast('Failed to save notes', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSavePayment = async () => {
    setSaving(true);
    try {
      await apiUpdateTask(task.id, {
        payment_amount_usd: paymentUsd,
      } as Partial<Task>);
      updateTask(task.id, { payment_amount_usd: paymentUsd });
      addToast('Payment amount saved', 'success');
    } catch {
      addToast('Failed to save payment', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleMarkPaid = async () => {
    setSaving(true);
    try {
      await apiUpdateTask(task.id, {
        payment_status: 'paid',
        payment_date: new Date().toISOString(),
        payment_amount_usd: paymentUsd,
      } as Partial<Task>);
      updateTask(task.id, {
        payment_status: 'paid',
        payment_date: new Date().toISOString(),
        payment_amount_usd: paymentUsd,
      });
      addToast('Marked as paid', 'success');
    } catch {
      addToast('Failed to mark as paid', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleReassign = async (newMemberId: string) => {
    setSaving(true);
    try {
      await apiUpdateTask(task.id, { assigned_to: newMemberId } as Partial<Task>);
      updateTask(task.id, { assigned_to: newMemberId });
      addToast('Task reassigned', 'success');
    } catch {
      addToast('Failed to reassign', 'error');
    } finally {
      setSaving(false);
    }
  };

  // Determine available actions
  const memberActions: { label: string; status: TaskStatus; color: string }[] = [];
  const adminActions: { label: string; status: TaskStatus; color: string }[] = [];

  if (isMember && isMyTask) {
    if (task.status === 'assigned') {
      memberActions.push({ label: t('tasks.claim'), status: 'working', color: 'btn-primary' });
    }
    if (task.status === 'working') {
      memberActions.push(
        { label: t('tasks.set_swof'), status: 'swof', color: 'btn-success' },
        { label: t('tasks.set_swf'), status: 'swf', color: 'btn-secondary' },
        { label: t('tasks.discard'), status: 'member_discarded', color: 'btn-danger' }
      );
    }
  }

  if (isAdmin) {
    if (['swf', 'swof', 'member_discarded'].includes(task.status)) {
      adminActions.push(
        { label: t('tasks.claim_studio'), status: 'in_studio', color: 'btn-primary' },
        { label: t('tasks.put_on_hold'), status: 'on_hold', color: 'btn-secondary' }
      );
    }
    if (task.status === 'on_hold') {
      adminActions.push({ label: t('tasks.claim_studio'), status: 'in_studio', color: 'btn-primary' });
    }
    if (task.status === 'in_studio') {
      adminActions.push({ label: t('tasks.set_in_review'), status: 'in_review', color: 'btn-primary' });
    }
    if (task.status === 'in_review' || task.status === 'sent_back') {
      adminActions.push(
        { label: t('tasks.approve'), status: 'approved', color: 'btn-success' },
        { label: t('tasks.send_back'), status: 'sent_back', color: 'btn-secondary' },
        { label: t('tasks.reject'), status: 'admin_discarded', color: 'btn-danger' }
      );
    }
  }

  return (
    <div className="task-detail-panel">
      <div className="task-detail-header">
        <div>
          <span className="task-id" style={{ fontSize: 'var(--text-sm)' }}>{task.task_id}</span>
          <div style={{ marginTop: 'var(--space-2)' }}>
            <StatusBadge status={task.status} />
          </div>
        </div>
        <button className="btn btn-ghost btn-icon" onClick={onClose}>
          <X size={20} />
        </button>
      </div>

      <div className="task-detail-body">
        {/* Assigned To */}
        <div className="task-detail-field">
          <div className="task-detail-field-label">{t('tasks.assigned_to')}</div>
          {isAdmin ? (
            <select
              className="form-select"
              value={task.assigned_to}
              onChange={(e) => handleReassign(e.target.value)}
              disabled={saving}
            >
              {members.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          ) : (
            <div className="member-cell">
              <div className="member-avatar">
                {task.expand?.assigned_to?.name?.charAt(0).toUpperCase() || '?'}
              </div>
              {task.expand?.assigned_to?.name || '—'}
            </div>
          )}
        </div>

        {/* Task Body */}
        <div className="task-detail-field">
          <div className="task-detail-field-label">{t('tasks.body')}</div>
          <div className="task-detail-body-text">{task.body || '—'}</div>
        </div>

        {/* Dates */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
          <div className="task-detail-field">
            <div className="task-detail-field-label">{t('tasks.created')}</div>
            <DateDisplay date={task.created} />
          </div>
          {task.member_verdict_date && (
            <div className="task-detail-field">
              <div className="task-detail-field-label">{t('tasks.member_verdict')}</div>
              <DateDisplay date={task.member_verdict_date} />
            </div>
          )}
        </div>

        {/* Admin Notes */}
        {isAdmin && (
          <div className="task-detail-field">
            <div className="task-detail-field-label">{t('tasks.notes')}</div>
            <div className="notes-section">
              <textarea
                className="form-textarea"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add notes about this task..."
                rows={3}
                style={{ minHeight: '80px' }}
              />
              <button
                className="btn btn-secondary btn-sm"
                onClick={handleSaveNotes}
                disabled={saving}
                style={{ marginTop: 'var(--space-2)' }}
              >
                <Save size={14} />
                {t('common.save')}
              </button>
            </div>
          </div>
        )}

        {/* Payment (Admin) */}
        {isAdmin && (task.status === 'approved' || task.payment_status === 'paid') && (
          <div className="task-detail-field">
            <div className="task-detail-field-label">{t('tasks.payment')}</div>
            <div className="notes-section">
              <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'end' }}>
                <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                  <label className="form-label">{t('payments.amount_usd')}</label>
                  <input
                    type="number"
                    className="form-input input-mono"
                    value={paymentUsd}
                    onChange={(e) => setPaymentUsd(Number(e.target.value))}
                    min={0}
                    step={0.01}
                  />
                </div>
                <button className="btn btn-secondary btn-sm" onClick={handleSavePayment} disabled={saving}>
                  <Save size={14} />
                </button>
              </div>
              {paymentUsd > 0 && (
                <div style={{ marginTop: 'var(--space-2)', fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
                  = {formatCurrency(usdToIrr(paymentUsd, settings.usd_to_irr_rate), 'IRR')}
                </div>
              )}
              {task.payment_status !== 'paid' && (
                <button
                  className="btn btn-success btn-sm"
                  onClick={handleMarkPaid}
                  disabled={saving || paymentUsd <= 0}
                  style={{ marginTop: 'var(--space-3)' }}
                >
                  {t('payments.mark_paid')}
                </button>
              )}
              {task.payment_status === 'paid' && (
                <div style={{ marginTop: 'var(--space-2)' }}>
                  <StatusBadge status="approved" />
                  <span style={{ marginInlineStart: 'var(--space-2)', fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
                    <DateDisplay date={task.payment_date} />
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Member can see payment info (read only) */}
        {isMember && task.payment_amount_usd > 0 && (
          <div className="task-detail-field">
            <div className="task-detail-field-label">{t('tasks.payment')}</div>
            <div className="notes-section">
              <div className="payment-amount">{formatCurrency(task.payment_amount_usd, 'USD')}</div>
              <div className="payment-amount-irr">
                {formatCurrency(usdToIrr(task.payment_amount_usd, settings.usd_to_irr_rate), 'IRR')}
              </div>
              {task.payment_status === 'paid' && (
                <div style={{ marginTop: 'var(--space-2)' }}>
                  <span className="status-badge" style={{ color: 'var(--color-success)', background: 'var(--color-success-bg)' }}>
                    ✅ {t('payment_status.paid')}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Action Buttons */}
      {(memberActions.length > 0 || adminActions.length > 0) && (
        <div className="task-detail-actions">
          {[...memberActions, ...adminActions].map((action) => (
            <button
              key={action.status}
              className={`btn ${action.color} btn-sm`}
              onClick={() => handleStatusChange(action.status)}
              disabled={saving}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
