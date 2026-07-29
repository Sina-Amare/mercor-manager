import { useState, useEffect } from 'react';
import { X, Save, CheckCircle, ArrowRight, ArrowLeft, AlertCircle } from 'lucide-react';
import { STATUS_CONFIG, type Task, type TaskStatus } from '../../types';
import { useAuthStore, useLanguageStore, useAppStore, useToastStore } from '../../store';
import StatusBadge from '../shared/StatusBadge';
import DateDisplay from '../shared/DateDisplay';
import { TaskConflictError, updateTask as apiUpdateTask } from '../../api/tasks';
import { formatCurrency, formatNumber, usdToIrr } from '../../utils/dates';

interface Props {
  task: Task;
  onClose: () => void;
  variant?: 'drawer' | 'page';
}

export default function TaskDetailPanel({ task, onClose, variant = 'drawer' }: Props) {
  const { user } = useAuthStore();
  const { t, language } = useLanguageStore();
  const { updateTask, removeTask, settings, members } = useAppStore();
  const { addToast } = useToastStore();
  const isAdmin = user?.role === 'admin';
  const isMember = user?.role === 'member';
  const isMyTask = task.assigned_to === user?.id;

  const [notes, setNotes] = useState(task.admin_notes || '');
  const [submissionPrompt, setSubmissionPrompt] = useState(task.submission_prompt || '');
  const [submissionDsp, setSubmissionDsp] = useState(task.submission_dsp || '');
  const [submissionFinalAnswer, setSubmissionFinalAnswer] = useState(
    task.submission_final_answer || ''
  );
  const [submissionNotes, setSubmissionNotes] = useState(task.submission_notes || '');
  const [studioResult, setStudioResult] = useState(task.studio_result || '');
  const [paymentUsd, setPaymentUsd] = useState(task.payment_amount_usd || 0);
  const [saving, setSaving] = useState(false);
  const [confirmingAction, setConfirmingAction] = useState<{ label: string; status: TaskStatus; color: string } | null>(null);
  const assignableMembers = members.filter(
    (member) => member.role === 'member' && member.is_active
  );
  const submissionVerdict =
    task.member_verdict === 'swf' || task.member_verdict === 'swof'
      ? task.member_verdict
      : null;
  const hasSubmissionVerdict = submissionVerdict !== null;
  const canManageSubmission = isAdmin || isMyTask;
  const canEditSubmission = hasSubmissionVerdict && canManageSubmission;
  const submissionDirty =
    submissionPrompt !== (task.submission_prompt || '') ||
    submissionDsp !== (task.submission_dsp || '') ||
    submissionFinalAnswer !== (task.submission_final_answer || '') ||
    submissionNotes !== (task.submission_notes || '') ||
    studioResult !== (task.studio_result || '');

  useEffect(() => {
    setNotes(task.admin_notes || '');
  }, [task.admin_notes, task.id]);

  useEffect(() => {
    setSubmissionPrompt(task.submission_prompt || '');
    setSubmissionDsp(task.submission_dsp || '');
    setSubmissionFinalAnswer(task.submission_final_answer || '');
    setSubmissionNotes(task.submission_notes || '');
    setStudioResult(task.studio_result || '');
  }, [
    task.id,
    task.submission_prompt,
    task.submission_dsp,
    task.submission_final_answer,
    task.submission_notes,
    task.studio_result,
  ]);

  useEffect(() => {
    setPaymentUsd(task.payment_amount_usd || 0);
  }, [task.id, task.payment_amount_usd]);

  // Close drawer on Escape key press
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleStatusChange = async (newStatus: TaskStatus, extraData?: Partial<Task>) => {
    setSaving(true);
    try {
      const data: Partial<Task> = { status: newStatus, ...extraData };
      if (['swf', 'swof', 'member_discarded'].includes(newStatus)) {
        data.member_verdict = newStatus as Task['member_verdict'];
        data.member_verdict_date = new Date().toISOString();
      }
      if (
        newStatus === 'working' &&
        ['swf', 'swof', 'member_discarded', 'sent_back'].includes(task.status)
      ) {
        data.member_verdict = '';
        data.member_verdict_date = '';
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
      const updated = await apiUpdateTask(task.id, data, {
        expectedStatus: task.status,
        expectedAssignee: isMember ? user?.id : undefined,
        expectedUpdated: task.updated,
      });
      updateTask(task.id, updated);
      addToast(`Task status updated to ${newStatus.toUpperCase()}`, 'success');
    } catch (error) {
      if (error instanceof TaskConflictError) {
        if (error.latestTask) {
          updateTask(task.id, error.latestTask);
        } else if (error.latestTask === null) {
          removeTask(task.id);
          onClose();
        }
        addToast(t('tasks.conflict'), 'warning');
      } else {
        addToast('Failed to update task', 'error');
      }
    } finally {
      setSaving(false);
      setConfirmingAction(null);
    }
  };

  const handleSaveSubmission = async () => {
    if (!canEditSubmission || !submissionDirty) return;

    setSaving(true);
    try {
      const updated = await apiUpdateTask(
        task.id,
        {
          submission_prompt: submissionPrompt,
          submission_dsp: submissionDsp,
          submission_final_answer: submissionFinalAnswer,
          submission_notes: submissionNotes,
          studio_result: studioResult,
        },
        {
          expectedStatus: task.status,
          expectedAssignee: task.assigned_to,
          expectedUpdated: task.updated,
        }
      );
      updateTask(task.id, updated);
      addToast(t('tasks.submission_saved'), 'success');
    } catch (error) {
      if (error instanceof TaskConflictError) {
        if (error.latestTask) {
          updateTask(task.id, error.latestTask);
        } else if (error.latestTask === null) {
          removeTask(task.id);
          onClose();
        }
        addToast(t('tasks.conflict'), 'warning');
      } else {
        addToast(t('tasks.submission_save_error'), 'error');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleSaveNotes = async () => {
    setSaving(true);
    try {
      const updated = await apiUpdateTask(task.id, { admin_notes: notes } as Partial<Task>);
      updateTask(task.id, updated);
      addToast('Notes saved successfully', 'success');
    } catch {
      addToast('Failed to save notes', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSavePayment = async () => {
    if (!Number.isFinite(paymentUsd) || paymentUsd < 0) {
      addToast('Enter a valid non-negative payment amount', 'error');
      return;
    }
    setSaving(true);
    try {
      const updated = await apiUpdateTask(task.id, {
        payment_amount_usd: paymentUsd,
      } as Partial<Task>);
      updateTask(task.id, updated);
      addToast('Payment amount saved', 'success');
    } catch {
      addToast('Failed to save payment', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleMarkPaid = async () => {
    if (!Number.isFinite(paymentUsd) || paymentUsd <= 0) {
      addToast('Enter a valid payment amount greater than zero', 'error');
      return;
    }
    setSaving(true);
    try {
      const paymentDate = new Date().toISOString();
      const updated = await apiUpdateTask(task.id, {
        payment_status: 'paid',
        payment_date: paymentDate,
        payment_amount_usd: paymentUsd,
      } as Partial<Task>);
      updateTask(task.id, updated);
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
      const updated = await apiUpdateTask(task.id, {
        payment_status: 'pending',
        payment_date: '',
      } as Partial<Task>);
      updateTask(task.id, updated);
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
      const updated = await apiUpdateTask(
        task.id,
        { assigned_to: newMemberId } as Partial<Task>,
        {
          expectedStatus: task.status,
          expectedAssignee: task.assigned_to,
          expectedUpdated: task.updated,
        }
      );
      updateTask(task.id, updated);
      addToast('Task reassigned successfully', 'success');
    } catch (error) {
      if (error instanceof TaskConflictError) {
        if (error.latestTask) {
          updateTask(task.id, error.latestTask);
        } else if (error.latestTask === null) {
          removeTask(task.id);
          onClose();
        }
        addToast(t('tasks.conflict'), 'warning');
      } else {
        addToast('Failed to reassign task', 'error');
      }
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
    if (s === 'sent_back') return 2;
    if (['approved', 'admin_discarded'].includes(s)) return 5;
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
        { label: t('tasks.set_swf'), status: 'swf', color: 'btn-success' },
        { label: t('tasks.set_swof'), status: 'swof', color: 'btn-secondary' },
        { label: t('tasks.discard'), status: 'member_discarded', color: 'btn-danger' }
      );
    }
    if (['swf', 'swof', 'member_discarded', 'sent_back'].includes(task.status)) {
      memberActions.push({ label: t('tasks.resume'), status: 'working', color: 'btn-primary' });
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
    if (task.status === 'in_review') {
      adminActions.push(
        { label: t('tasks.approve'), status: 'approved', color: 'btn-success' },
        { label: t('tasks.send_back'), status: 'sent_back', color: 'btn-secondary' },
        { label: t('tasks.reject'), status: 'admin_discarded', color: 'btn-danger' }
      );
    }
  }

  return (
    <div
      className={`task-detail-panel ${variant === 'page' ? 'task-detail-page' : ''}`}
      role={variant === 'page' ? 'region' : 'dialog'}
      aria-modal={variant === 'drawer' ? true : undefined}
    >
      {/* Panel Header */}
      <div className="task-detail-header">
        <div className="task-detail-heading">
          <span className="task-id">{task.task_id}</span>
          <StatusBadge status={task.status} />
        </div>
        <button
          className="btn btn-ghost btn-icon btn-sm"
          onClick={onClose}
          title={variant === 'page' ? t('common.back') : t('common.close')}
          aria-label={variant === 'page' ? t('common.back') : t('common.close')}
        >
          {variant === 'page' ? (
            <ArrowLeft className="task-workspace-back-icon" size={18} />
          ) : (
            <X size={18} />
          )}
        </button>
      </div>

      <div className="task-detail-body">
        {/* Visual Lifecycle Stepper */}
        <div className="stepper">
          <div className={`stepper-step ${currentStage >= 1 ? (currentStage > 1 ? 'completed' : 'active') : ''}`}>
            <span>{formatNumber(1, language)}. {t('status.assigned')}</span>
          </div>
          <ArrowRight className="stepper-arrow" size={12} />
          <div className={`stepper-step ${currentStage >= 2 ? (currentStage > 2 ? 'completed' : 'active') : ''}`}>
            <span>{formatNumber(2, language)}. {t('status.working')}</span>
          </div>
          <ArrowRight className="stepper-arrow" size={12} />
          <div className={`stepper-step ${currentStage >= 3 ? (currentStage > 3 ? 'completed' : 'active') : ''}`}>
            <span>{formatNumber(3, language)}. {t('tasks.verdict')}</span>
          </div>
          <ArrowRight className="stepper-arrow" size={12} />
          <div className={`stepper-step ${currentStage >= 4 ? (currentStage > 4 ? 'completed' : 'active') : ''}`}>
            <span>{formatNumber(4, language)}. {t('status.in_studio')}</span>
          </div>
          <ArrowRight className="stepper-arrow" size={12} />
          <div className={`stepper-step ${currentStage >= 5 ? 'completed' : ''}`}>
            <span>{formatNumber(5, language)}. {t('tasks.final')}</span>
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
              {assignableMembers.map((m) => (
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
              <span style={{ fontWeight: 'var(--weight-semibold)' }}>
                {task.expand?.assigned_to?.name || '—'}
              </span>
            </div>
          )}
        </div>

        {/* Task Body / Text Prompt */}
        <div className="task-detail-field">
          <div className="task-detail-field-label">{t('upload.body_label')}</div>
          <div className="task-detail-body-text">{task.body}</div>
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

        {/* Collaborative Submission Details */}
        {canManageSubmission && !hasSubmissionVerdict && (
          <div className="task-submission-locked" role="note">
            <AlertCircle size={18} aria-hidden="true" />
            <div>
              <strong>{t('tasks.submission_details')}</strong>
              <span>{t('tasks.submission_locked')}</span>
            </div>
          </div>
        )}

        {canManageSubmission && submissionVerdict && (
          <section className="task-submission-section" aria-labelledby="task-submission-title">
            <div className="task-submission-header">
              <div>
                <h3 id="task-submission-title">{t('tasks.submission_details')}</h3>
                <p>{t('tasks.submission_help')}</p>
              </div>
              <StatusBadge status={submissionVerdict} />
            </div>

            <div className="task-submission-grid">
              <label className="task-submission-field">
                <span>{t('tasks.submission_prompt')}</span>
                <textarea
                  className="form-textarea task-submission-textarea"
                  value={submissionPrompt}
                  onChange={(event) => setSubmissionPrompt(event.target.value)}
                  placeholder={t('tasks.submission_prompt_placeholder')}
                  rows={5}
                  dir="auto"
                  disabled={!canEditSubmission || saving}
                />
              </label>

              <label className="task-submission-field">
                <span>{t('tasks.submission_dsp')}</span>
                <textarea
                  className="form-textarea task-submission-textarea"
                  value={submissionDsp}
                  onChange={(event) => setSubmissionDsp(event.target.value)}
                  placeholder={t('tasks.submission_dsp_placeholder')}
                  rows={5}
                  dir="auto"
                  disabled={!canEditSubmission || saving}
                />
              </label>

              <label className="task-submission-field">
                <span>{t('tasks.submission_final_answer')}</span>
                <textarea
                  className="form-textarea task-submission-textarea"
                  value={submissionFinalAnswer}
                  onChange={(event) => setSubmissionFinalAnswer(event.target.value)}
                  placeholder={t('tasks.submission_final_answer_placeholder')}
                  rows={5}
                  dir="auto"
                  disabled={!canEditSubmission || saving}
                />
              </label>

              <label className="task-submission-field">
                <span>{t('tasks.submission_notes')}</span>
                <textarea
                  className="form-textarea task-submission-textarea"
                  value={submissionNotes}
                  onChange={(event) => setSubmissionNotes(event.target.value)}
                  placeholder={t('tasks.submission_notes_placeholder')}
                  rows={5}
                  dir="auto"
                  disabled={!canEditSubmission || saving}
                />
              </label>
            </div>

            <label className="task-submission-field task-studio-result">
              <span>{t('tasks.studio_result')}</span>
              <small>{t('tasks.studio_result_help')}</small>
              <textarea
                className="form-textarea task-submission-textarea"
                value={studioResult}
                onChange={(event) => setStudioResult(event.target.value)}
                placeholder={t('tasks.studio_result_placeholder')}
                rows={5}
                dir="auto"
                disabled={!canEditSubmission || saving}
              />
            </label>

            <div className="task-submission-actions">
              <button
                className="btn btn-primary btn-sm"
                onClick={handleSaveSubmission}
                disabled={saving || !canEditSubmission || !submissionDirty}
              >
                <Save size={14} aria-hidden="true" />
                {t('common.save')}
              </button>
            </div>
          </section>
        )}

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
                  = {formatCurrency(usdToIrr(paymentUsd, settings.usd_to_irr_rate), 'IRR', language)}
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

        {/* Member Payment View (Visible ONLY to the assigned member) */}
        {isMember && isMyTask && task.payment_amount_usd > 0 && (
          <div className="task-detail-field">
            <div className="task-detail-field-label">{t('tasks.payment')}</div>
            <div style={{ background: 'var(--color-surface)', padding: 'var(--space-4)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)' }}>
              <div className="payment-amount" style={{ fontSize: 'var(--text-lg)' }}>
                {formatCurrency(task.payment_amount_usd, 'USD', language)}
              </div>
              <div className="payment-amount-irr">
                {formatCurrency(usdToIrr(task.payment_amount_usd, settings.usd_to_irr_rate), 'IRR', language)}
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

      {/* Action Status Confirmation Modal */}
      {confirmingAction && (
        <>
          <div className="modal-backdrop" onClick={() => setConfirmingAction(null)} />
          <div className="modal" role="dialog" aria-modal="true" style={{ zIndex: 310 }}>
            <div className="modal-header">
              <h3 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <AlertCircle size={20} style={{ color: 'var(--color-primary)' }} />
                Confirm Action: {confirmingAction.label}
              </h3>
              <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setConfirmingAction(null)}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-primary)' }}>
                Are you sure you want to update task <strong className="input-mono">{task.task_id}</strong> to status: <strong>{confirmingAction.label}</strong>?
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setConfirmingAction(null)}>
                {t('common.cancel')}
              </button>
              <button
                className={`btn ${confirmingAction.color}`}
                onClick={() => handleStatusChange(confirmingAction.status)}
                disabled={saving}
              >
                Confirm {confirmingAction.label}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Primary Action Controls */}
      {(memberActions.length > 0 || adminActions.length > 0) && (
        <div className="task-detail-actions">
          {[...memberActions, ...adminActions].map((action) => (
            <button
              key={action.status}
              className={`btn ${action.color} btn-sm`}
              onClick={() => setConfirmingAction(action)}
              disabled={saving}
              style={{ flex: 1 }}
            >
              <span aria-hidden="true">{STATUS_CONFIG[action.status].icon}</span>
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
