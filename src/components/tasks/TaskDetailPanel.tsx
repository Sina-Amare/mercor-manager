import { useState } from 'react';
import { X, Save, CheckCircle, ArrowRight } from 'lucide-react';
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
      addToast('Notes saved successfully', 'success');
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

  const handleRevertPayment = async () => {
    setSaving(true);
    try {
      await apiUpdateTask(task.id, {
        payment_status: 'pending',
        payment_date: '',
      } as Partial<Task>);
      updateTask(task.id, {
        payment_status: 'pending',
        payment_date: '',
      });
      addToast('Payment status reverted to Pending', 'success');
    } catch {
      addToast('Failed to revert payment', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleReassign = async (newMemberId: string) => {
    setSaving(true);
    try {
      await apiUpdateTask(task.id, { assigned_to: newMemberId } as Partial<Task>);
      updateTask(task.id, { assigned_to: newMemberId });
      addToast('Task reassigned successfully', 'success');
    } catch {
      addToast('Failed to reassign task', 'error');
    } finally {
      setSaving(false);
    }
  };

  // Determine stage index for the stepper
  const getStageIndex = (s: TaskStatus) => {
    if (s === 'assigned') return 1;
    if (s === 'working') return 2;
    if (['swf', 'swof', 'member_discarded'].includes(s)) return 3;
    if (['in_studio', 'in_review', 'on_hold'].includes(s)) return 4;
    if (['approved', 'sent_back', 'admin_discarded'].includes(s)) return 5;
    return 1;
  };

  const currentStage = getStageIndex(task.status);

  // Available buttons
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
      {/* Drawer Header */}
      <div className="task-detail-header">
        <div>
          <span className="task-id">{task.task_id}</span>
          <div style={{ marginTop: 'var(--space-2)' }}>
            <StatusBadge status={task.status} />
          </div>
        </div>
        <button className="btn btn-ghost btn-icon" onClick={onClose}>
          <X size={18} />
        </button>
      </div>

      <div className="task-detail-body">
        {/* Visual Lifecycle Stepper */}
        <div className="stepper">
          <div className={`stepper-step ${currentStage >= 1 ? (currentStage > 1 ? 'completed' : 'active') : ''}`}>
            <span>1. Assigned</span>
          </div>
          <ArrowRight className="stepper-arrow" size={12} />
          <div className={`stepper-step ${currentStage >= 2 ? (currentStage > 2 ? 'completed' : 'active') : ''}`}>
            <span>2. Working</span>
          </div>
          <ArrowRight className="stepper-arrow" size={12} />
          <div className={`stepper-step ${currentStage >= 3 ? (currentStage > 3 ? 'completed' : 'active') : ''}`}>
            <span>3. Verdict</span>
          </div>
          <ArrowRight className="stepper-arrow" size={12} />
          <div className={`stepper-step ${currentStage >= 4 ? (currentStage > 4 ? 'completed' : 'active') : ''}`}>
            <span>4. Studio</span>
          </div>
          <ArrowRight className="stepper-arrow" size={12} />
          <div className={`stepper-step ${currentStage >= 5 ? 'completed' : ''}`}>
            <span>5. Final</span>
          </div>
        </div>

        {/* Member Assignment */}
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
                <option key={m.id} value={m.id}>
                  {m.name} (@{m.username})
                </option>
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

        {/* Task Body Text */}
        <div className="task-detail-field">
          <div className="task-detail-field-label">{t('tasks.body')}</div>
          <div className="task-detail-body-text">{task.body || '—'}</div>
        </div>

        {/* Timeline & Verdict Dates */}
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
            <div style={{ background: 'var(--color-surface)', padding: 'var(--space-3)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)' }}>
              <textarea
                className="form-textarea"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add private admin notes..."
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

        {/* Payment Settings (Admin) */}
        {isAdmin && (task.status === 'approved' || task.payment_status === 'paid') && (
          <div className="task-detail-field">
            <div className="task-detail-field-label">{t('tasks.payment')}</div>
            <div style={{ background: 'var(--color-surface)', padding: 'var(--space-4)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)' }}>
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
                <div style={{ marginTop: 'var(--space-2)', fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', fontFamily: 'var(--font-mono)' }}>
                  = {formatCurrency(usdToIrr(paymentUsd, settings.usd_to_irr_rate), 'IRR')}
                </div>
              )}
              {task.payment_status !== 'paid' && (
                <button
                  className="btn btn-success btn-sm"
                  onClick={handleMarkPaid}
                  disabled={saving || paymentUsd <= 0}
                  style={{ marginTop: 'var(--space-3)', width: '100%' }}
                >
                  <CheckCircle size={14} />
                  {t('payments.mark_paid')}
                </button>
              )}
              {task.payment_status === 'paid' && (
                <div style={{ marginTop: 'var(--space-3)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
                    <span className="status-badge" style={{ color: 'var(--color-success)', background: 'var(--color-success-bg)' }}>
                      ✅ {t('payment_status.paid')}
                    </span>
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
                      <DateDisplay date={task.payment_date} />
                    </span>
                  </div>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={handleRevertPayment}
                    disabled={saving}
                    style={{ width: '100%', color: 'var(--color-warning)' }}
                  >
                    Revert to Pending Payment
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Member Payment View */}
        {isMember && task.payment_amount_usd > 0 && (
          <div className="task-detail-field">
            <div className="task-detail-field-label">{t('tasks.payment')}</div>
            <div style={{ background: 'var(--color-surface)', padding: 'var(--space-4)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)' }}>
              <div className="payment-amount" style={{ fontSize: 'var(--text-lg)' }}>
                {formatCurrency(task.payment_amount_usd, 'USD')}
              </div>
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

      {/* Primary Action Controls */}
      {(memberActions.length > 0 || adminActions.length > 0) && (
        <div className="task-detail-actions">
          {[...memberActions, ...adminActions].map((action) => (
            <button
              key={action.status}
              className={`btn ${action.color} btn-sm`}
              onClick={() => handleStatusChange(action.status)}
              disabled={saving}
              style={{ flex: 1 }}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
