import { useState, useEffect, useRef } from 'react';
import {
  X,
  Save,
  CheckCircle,
  ArrowRight,
  ArrowLeft,
  AlertCircle,
  RotateCcw,
} from 'lucide-react';
import {
  MEMBER_VERDICTS,
  STATUS_CONFIG,
  type Task,
  type TaskStatus,
} from '../../types';
import { useAuthStore, useLanguageStore, useAppStore, useToastStore } from '../../store';
import StatusBadge from '../shared/StatusBadge';
import DateDisplay from '../shared/DateDisplay';
import CopyButton from '../shared/CopyButton';
import { TaskConflictError, updateTask as apiUpdateTask } from '../../api/tasks';
import { formatCurrency, formatNumber, usdToIrr } from '../../utils/dates';

interface Props {
  task: Task;
  onClose: () => void;
  variant?: 'drawer' | 'page';
}

interface TaskAction {
  label: string;
  status: TaskStatus;
  color: string;
  kind?: 'forward' | 'revert';
  extraData?: Partial<Task>;
}

const SUBMISSION_VISIBLE_STATUSES: readonly TaskStatus[] = [
  'swf',
  'swof',
  'on_hold',
  'in_studio',
  'in_review',
  'approved',
  'sent_back',
  'admin_discarded',
];

const SUBMISSION_EDITABLE_STATUSES: readonly TaskStatus[] = [
  'swf',
  'swof',
  'on_hold',
  'in_studio',
  'in_review',
  'sent_back',
];

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
  const [submissionChangedRemotely, setSubmissionChangedRemotely] = useState(false);
  const submissionTaskIdRef = useRef(task.id);
  const submissionBaseUpdatedRef = useRef(task.updated);
  const submissionDirtyRef = useRef(false);
  const [paymentUsd, setPaymentUsd] = useState(task.payment_amount_usd || 0);
  const [saving, setSaving] = useState(false);
  const [confirmingAction, setConfirmingAction] = useState<TaskAction | null>(null);
  const assignableMembers = members.filter(
    (member) => member.role === 'member' && member.is_active
  );
  const submissionVerdict =
    task.member_verdict === 'swf' || task.member_verdict === 'swof'
      ? task.member_verdict
      : null;
  const canManageSubmission = isAdmin || isMyTask;
  const hasSubmissionData = Boolean(
    task.submission_prompt ||
    task.submission_dsp ||
    task.submission_final_answer ||
    task.submission_notes ||
    task.studio_result
  );
  const submissionStageVisible = SUBMISSION_VISIBLE_STATUSES.includes(task.status);
  const showSubmissionFields =
    canManageSubmission && (submissionStageVisible || hasSubmissionData);
  const canEditSubmission =
    canManageSubmission && SUBMISSION_EDITABLE_STATUSES.includes(task.status);
  const submissionStatus = submissionVerdict || (submissionStageVisible ? task.status : null);
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
    const taskChanged = submissionTaskIdRef.current !== task.id;
    if (taskChanged || !submissionDirtyRef.current) {
      setSubmissionPrompt(task.submission_prompt || '');
      setSubmissionDsp(task.submission_dsp || '');
      setSubmissionFinalAnswer(task.submission_final_answer || '');
      setSubmissionNotes(task.submission_notes || '');
      setStudioResult(task.studio_result || '');
      submissionTaskIdRef.current = task.id;
      submissionBaseUpdatedRef.current = task.updated;
      setSubmissionChangedRemotely(false);
    } else if (task.updated !== submissionBaseUpdatedRef.current) {
      setSubmissionChangedRemotely(true);
    }
  }, [
    task.id,
    task.updated,
    task.submission_prompt,
    task.submission_dsp,
    task.submission_final_answer,
    task.submission_notes,
    task.studio_result,
  ]);

  useEffect(() => {
    submissionDirtyRef.current = submissionDirty;
  }, [submissionDirty]);

  useEffect(() => {
    setPaymentUsd(task.payment_amount_usd || 0);
  }, [task.id, task.payment_amount_usd]);

  const markSubmissionSynchronized = (updatedTask: Task) => {
    submissionBaseUpdatedRef.current = updatedTask.updated;
    submissionDirtyRef.current = false;
    setSubmissionChangedRemotely(false);
  };

  const loadLatestSubmission = () => {
    setSubmissionPrompt(task.submission_prompt || '');
    setSubmissionDsp(task.submission_dsp || '');
    setSubmissionFinalAnswer(task.submission_final_answer || '');
    setSubmissionNotes(task.submission_notes || '');
    setStudioResult(task.studio_result || '');
    submissionBaseUpdatedRef.current = task.updated;
    submissionDirtyRef.current = false;
    setSubmissionChangedRemotely(false);
    addToast(t('tasks.latest_submission_loaded'), 'success');
  };

  // Close drawer on Escape key press
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleStatusChange = async (
    newStatus: TaskStatus,
    extraData?: Partial<Task>,
    feedback?: { success: string; error: string }
  ) => {
    setSaving(true);
    try {
      const data: Partial<Task> = { status: newStatus };
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
      if (canEditSubmission && submissionDirtyRef.current) {
        Object.assign(data, {
          submission_prompt: submissionPrompt,
          submission_dsp: submissionDsp,
          submission_final_answer: submissionFinalAnswer,
          submission_notes: submissionNotes,
          studio_result: studioResult,
        });
      }
      Object.assign(data, extraData);
      const updated = await apiUpdateTask(task.id, data, {
        expectedStatus: task.status,
        expectedAssignee: isMember ? user?.id : undefined,
        expectedUpdated: submissionDirtyRef.current
          ? submissionBaseUpdatedRef.current
          : task.updated,
      });
      markSubmissionSynchronized(updated);
      updateTask(task.id, updated);
      addToast(
        feedback?.success || `${t('tasks.status_updated')} ${t(`status.${newStatus}`)}`,
        'success'
      );
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
        addToast(feedback?.error || t('tasks.status_update_error'), 'error');
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
          expectedUpdated: submissionBaseUpdatedRef.current,
        }
      );
      markSubmissionSynchronized(updated);
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

  const focusSubmissionNotes = () => {
    window.requestAnimationFrame(() => {
      const notesField = document.querySelector<HTMLTextAreaElement>(
        '#task-submission-notes'
      );
      notesField?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      notesField?.focus();
    });
  };

  const handleSubmitForReview = async () => {
    if (!isAdmin || task.status !== 'in_studio' || saving) return;
    if (!submissionNotes.trim()) {
      setConfirmingAction(null);
      addToast(t('tasks.review_note_required'), 'error');
      focusSubmissionNotes();
      return;
    }

    setSaving(true);
    try {
      const updated = await apiUpdateTask(
        task.id,
        {
          status: 'in_review',
          submission_prompt: submissionPrompt,
          submission_dsp: submissionDsp,
          submission_final_answer: submissionFinalAnswer,
          submission_notes: submissionNotes,
          studio_result: studioResult,
        },
        {
          expectedStatus: 'in_studio',
          expectedAssignee: task.assigned_to,
          expectedUpdated: submissionBaseUpdatedRef.current,
        }
      );
      markSubmissionSynchronized(updated);
      updateTask(task.id, updated);
      addToast(t('tasks.submitted_for_review'), 'success');
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
        addToast(t('tasks.submit_for_review_error'), 'error');
      }
    } finally {
      setSaving(false);
      setConfirmingAction(null);
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
      const updated = await apiUpdateTask(
        task.id,
        {
          payment_status: 'pending',
          payment_date: '',
        } as Partial<Task>,
        {
          expectedStatus: task.status,
          expectedAssignee: task.assigned_to,
          expectedUpdated: task.updated,
        }
      );
      updateTask(task.id, updated);
      addToast(t('payments.reverted_pending'), 'success');
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
        addToast(t('payments.revert_error'), 'error');
      }
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
    if (['swf', 'swof', 'member_discarded', 'on_hold'].includes(s)) return 3;
    if (s === 'in_studio') return 4;
    if (s === 'in_review') return 5;
    if (s === 'sent_back') return 2;
    if (['approved', 'admin_discarded'].includes(s)) return 6;
    return 1;
  };

  const currentStage = getStageIndex(task.status);

  // Available buttons
  const memberActions: TaskAction[] = [];
  const adminActions: TaskAction[] = [];

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
      adminActions.push({
        label: t('tasks.submit_for_review'),
        status: 'in_review',
        color: 'btn-primary',
      });
    }
    if (task.status === 'in_review') {
      adminActions.push(
        { label: t('tasks.approve'), status: 'approved', color: 'btn-success' },
        { label: t('tasks.send_back'), status: 'sent_back', color: 'btn-secondary' },
        { label: t('tasks.reject'), status: 'admin_discarded', color: 'btn-danger' }
      );
    }
  }

  // Status changes are intentionally limited to the adjacent workflow stage.
  // This keeps verdict, Studio, Review, and payment invariants intact.
  const submittedStatus =
    MEMBER_VERDICTS.find((verdict) => verdict === task.member_verdict) || null;
  let rollbackTarget: TaskStatus | null = null;
  let rollbackExtraData: Partial<Task> | undefined;
  let rollbackBlockedReason = '';

  if (isAdmin) {
    if (task.status === 'working') {
      rollbackTarget = 'assigned';
    } else if (MEMBER_VERDICTS.some((verdict) => verdict === task.status)) {
      rollbackTarget = 'working';
    } else if (task.status === 'on_hold' || task.status === 'in_studio') {
      rollbackTarget = submittedStatus;
      rollbackExtraData = submittedStatus
        ? {
            member_verdict: submittedStatus,
            member_verdict_date: task.member_verdict_date,
          }
        : undefined;
    } else if (task.status === 'in_review') {
      rollbackTarget = 'in_studio';
    } else if (task.status === 'approved') {
      rollbackTarget = 'in_review';
      rollbackExtraData = {
        admin_verdict: '',
        admin_verdict_date: '',
        payment_status: 'not_applicable',
        payment_date: '',
      };
      if (task.payment_status === 'paid') {
        rollbackBlockedReason = t('tasks.revert_payment_blocked');
      }
    } else if (task.status === 'sent_back' || task.status === 'admin_discarded') {
      rollbackTarget = 'in_review';
      rollbackExtraData = {
        admin_verdict: '',
        admin_verdict_date: '',
      };
    }
  } else if (isMember && isMyTask) {
    if (task.status === 'working') {
      rollbackTarget = 'assigned';
    } else if (
      MEMBER_VERDICTS.some((verdict) => verdict === task.status) ||
      task.status === 'sent_back'
    ) {
      rollbackTarget = 'working';
    }
  }

  if (rollbackTarget && canEditSubmission && submissionDirty) {
    rollbackExtraData = {
      ...rollbackExtraData,
      submission_prompt: submissionPrompt,
      submission_dsp: submissionDsp,
      submission_final_answer: submissionFinalAnswer,
      submission_notes: submissionNotes,
      studio_result: studioResult,
    };
  }

  const rollbackAction: TaskAction | null = rollbackTarget
    ? {
        label: `${t('tasks.revert_to')} ${t(`status.${rollbackTarget}`)}`,
        status: rollbackTarget,
        color: 'btn-secondary',
        kind: 'revert',
        extraData: rollbackExtraData,
      }
    : null;
  const forwardActions: TaskAction[] = [...memberActions, ...adminActions];

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
          <CopyButton
            text={task.task_id}
            compact
            ariaLabel={`${t('common.copy')}: ${t('tasks.task_id')}`}
          />
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
            <span>{formatNumber(3, language)}. {t('tasks.submitted')}</span>
          </div>
          <ArrowRight className="stepper-arrow" size={12} />
          <div className={`stepper-step ${currentStage >= 4 ? (currentStage > 4 ? 'completed' : 'active') : ''}`}>
            <span>{formatNumber(4, language)}. {t('status.in_studio')}</span>
          </div>
          <ArrowRight className="stepper-arrow" size={12} />
          <div className={`stepper-step ${currentStage >= 5 ? (currentStage > 5 ? 'completed' : 'active') : ''}`}>
            <span>{formatNumber(5, language)}. {t('status.in_review')}</span>
          </div>
          <ArrowRight className="stepper-arrow" size={12} />
          <div className={`stepper-step ${currentStage >= 6 ? 'completed' : ''}`}>
            <span>{formatNumber(6, language)}. {t('tasks.final')}</span>
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
          <div className="task-copy-heading">
            <div className="task-detail-field-label">{t('upload.body_label')}</div>
            <CopyButton
              text={task.body}
              compact
              ariaLabel={`${t('common.copy')}: ${t('upload.body_label')}`}
            />
          </div>
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
        {canManageSubmission && !showSubmissionFields && (
          <div className="task-submission-locked" role="note">
            <AlertCircle size={18} aria-hidden="true" />
            <div>
              <strong>{t('tasks.submission_details')}</strong>
              <span>{t('tasks.submission_locked')}</span>
            </div>
          </div>
        )}

        {showSubmissionFields && (
          <section className="task-submission-section" aria-labelledby="task-submission-title">
            <div className="task-submission-header">
              <div>
                <h3 id="task-submission-title">{t('tasks.submission_details')}</h3>
                <p>{t('tasks.submission_help')}</p>
              </div>
              {submissionStatus ? <StatusBadge status={submissionStatus} /> : null}
            </div>

            {task.status === 'in_studio' ? (
              <div className="task-studio-workflow" role="note">
                <AlertCircle size={19} aria-hidden="true" />
                <div>
                  <strong>{t('tasks.studio_workflow_title')}</strong>
                  <span>
                    {isAdmin
                      ? t('tasks.studio_workflow_admin_help')
                      : t('tasks.studio_workflow_member_help')}
                  </span>
                </div>
              </div>
            ) : null}

            {submissionChangedRemotely ? (
              <div className="task-submission-conflict" role="alert">
                <AlertCircle size={19} aria-hidden="true" />
                <div>
                  <strong>{t('tasks.submission_changed_remote_title')}</strong>
                  <span>{t('tasks.submission_changed_remote_help')}</span>
                </div>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={loadLatestSubmission}
                  disabled={saving}
                >
                  {t('tasks.load_latest')}
                </button>
              </div>
            ) : null}

            {!canEditSubmission ? (
              <div className="task-submission-readonly" role="note">
                {t('tasks.submission_readonly')}
              </div>
            ) : null}

            <div className="task-submission-grid">
              <div className="task-submission-field">
                <div className="task-copy-heading">
                  <label htmlFor="task-submission-prompt">
                    {t('tasks.submission_prompt')}
                  </label>
                  <CopyButton
                    text={submissionPrompt}
                    compact
                    ariaLabel={`${t('common.copy')}: ${t('tasks.submission_prompt')}`}
                  />
                </div>
                <textarea
                  id="task-submission-prompt"
                  className="form-textarea task-submission-textarea"
                  value={submissionPrompt}
                  onChange={(event) => setSubmissionPrompt(event.target.value)}
                  placeholder={t('tasks.submission_prompt_placeholder')}
                  rows={5}
                  dir="auto"
                  disabled={!canEditSubmission || saving}
                />
              </div>

              <div className="task-submission-field">
                <div className="task-copy-heading">
                  <label htmlFor="task-submission-dsp">
                    {t('tasks.submission_dsp')}
                  </label>
                  <CopyButton
                    text={submissionDsp}
                    compact
                    ariaLabel={`${t('common.copy')}: ${t('tasks.submission_dsp')}`}
                  />
                </div>
                <textarea
                  id="task-submission-dsp"
                  className="form-textarea task-submission-textarea"
                  value={submissionDsp}
                  onChange={(event) => setSubmissionDsp(event.target.value)}
                  placeholder={t('tasks.submission_dsp_placeholder')}
                  rows={5}
                  dir="auto"
                  disabled={!canEditSubmission || saving}
                />
              </div>

              <div className="task-submission-field">
                <div className="task-copy-heading">
                  <label htmlFor="task-submission-final-answer">
                    {t('tasks.submission_final_answer')}
                  </label>
                  <CopyButton
                    text={submissionFinalAnswer}
                    compact
                    ariaLabel={`${t('common.copy')}: ${t('tasks.submission_final_answer')}`}
                  />
                </div>
                <textarea
                  id="task-submission-final-answer"
                  className="form-textarea task-submission-textarea"
                  value={submissionFinalAnswer}
                  onChange={(event) => setSubmissionFinalAnswer(event.target.value)}
                  placeholder={t('tasks.submission_final_answer_placeholder')}
                  rows={5}
                  dir="auto"
                  disabled={!canEditSubmission || saving}
                />
              </div>

              <div className="task-submission-field">
                <div className="task-copy-heading">
                  <label htmlFor="task-submission-notes">
                    {task.status === 'in_studio'
                      ? t('tasks.submission_notes_required')
                      : t('tasks.submission_notes')}
                  </label>
                  <CopyButton
                    text={submissionNotes}
                    compact
                    ariaLabel={`${t('common.copy')}: ${t('tasks.submission_notes')}`}
                  />
                </div>
                <textarea
                  id="task-submission-notes"
                  className="form-textarea task-submission-textarea"
                  value={submissionNotes}
                  onChange={(event) => setSubmissionNotes(event.target.value)}
                  placeholder={t('tasks.submission_notes_placeholder')}
                  rows={5}
                  dir="auto"
                  required={task.status === 'in_studio'}
                  aria-required={task.status === 'in_studio'}
                  disabled={!canEditSubmission || saving}
                />
              </div>
            </div>

            <div className="task-submission-field task-studio-result">
              <div className="task-copy-heading">
                <label htmlFor="task-studio-result">{t('tasks.studio_result')}</label>
                <CopyButton
                  text={studioResult}
                  compact
                  ariaLabel={`${t('common.copy')}: ${t('tasks.studio_result')}`}
                />
              </div>
              <small>{t('tasks.studio_result_help')}</small>
              <textarea
                id="task-studio-result"
                className="form-textarea task-submission-textarea"
                value={studioResult}
                onChange={(event) => setStudioResult(event.target.value)}
                placeholder={t('tasks.studio_result_placeholder')}
                rows={5}
                dir="auto"
                disabled={!canEditSubmission || saving}
              />
            </div>

            {canEditSubmission ? (
              <div className="task-submission-actions">
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={handleSaveSubmission}
                  disabled={saving || !submissionDirty}
                >
                  <Save size={14} aria-hidden="true" />
                  {task.status === 'in_studio'
                    ? t('tasks.save_draft')
                    : t('common.save')}
                </button>
              </div>
            ) : null}
          </section>
        )}

        {/* Admin Notes */}
        {isAdmin && (
          <div className="task-detail-field">
            <div className="task-copy-heading">
              <div className="task-detail-field-label">{t('tasks.notes')}</div>
              <CopyButton
                text={notes}
                compact
                ariaLabel={`${t('common.copy')}: ${t('tasks.notes')}`}
              />
            </div>
            <div style={{ background: 'var(--color-surface)', padding: 'var(--space-3)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)' }}>
              <textarea
                className="form-textarea"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t('tasks.private_admin_notes_placeholder')}
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
                    {t('payments.revert_pending')}
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
                {confirmingAction.kind === 'revert' ? (
                  <RotateCcw size={20} style={{ color: 'var(--color-warning)' }} />
                ) : (
                  <AlertCircle size={20} style={{ color: 'var(--color-primary)' }} />
                )}
                {confirmingAction.kind === 'revert'
                  ? t('tasks.confirm_revert_title')
                  : confirmingAction.label}
              </h3>
              <button
                className="btn btn-ghost btn-icon btn-sm"
                onClick={() => setConfirmingAction(null)}
                aria-label={t('common.close')}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              {confirmingAction.kind === 'revert' ? (
                <>
                  <p className="task-revert-confirm-copy">
                    {t('tasks.revert_confirm')}
                  </p>
                  <div className="task-status-transition" aria-label={t('tasks.status_change')}>
                    <StatusBadge status={task.status} />
                    <ArrowRight size={16} aria-hidden="true" />
                    <StatusBadge status={confirmingAction.status} />
                  </div>
                </>
              ) : (
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-primary)' }}>
                  {confirmingAction.status === 'in_review' && task.status === 'in_studio'
                    ? t('tasks.submit_for_review_confirm')
                    : (
                    <>
                      Are you sure you want to update task{' '}
                      <strong className="input-mono">{task.task_id}</strong> to status:{' '}
                      <strong>{confirmingAction.label}</strong>?
                    </>
                  )}
                </p>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setConfirmingAction(null)}>
                {t('common.cancel')}
              </button>
              <button
                className={`btn ${confirmingAction.color}`}
                onClick={() =>
                  confirmingAction.kind === 'revert'
                    ? void handleStatusChange(
                        confirmingAction.status,
                        confirmingAction.extraData,
                        {
                          success: `${t('tasks.reverted_to')} ${t(
                            `status.${confirmingAction.status}`
                          )}`,
                          error: t('tasks.revert_error'),
                        }
                      )
                    : confirmingAction.status === 'in_review' && task.status === 'in_studio'
                    ? void handleSubmitForReview()
                    : void handleStatusChange(confirmingAction.status)
                }
                disabled={saving}
              >
                {confirmingAction.kind === 'revert'
                  ? t('tasks.confirm_revert')
                  : `${t('common.confirm')} ${confirmingAction.label}`}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Reversible, adjacent workflow controls */}
      {(rollbackAction || forwardActions.length > 0) && (
        <div className="task-detail-actions">
          {rollbackAction ? (
            <div className="task-action-group task-action-group-previous">
              <span className="task-action-group-label">{t('tasks.previous_step')}</span>
              <button
                className={`btn ${rollbackAction.color} btn-sm`}
                onClick={() => setConfirmingAction(rollbackAction)}
                disabled={saving || Boolean(rollbackBlockedReason)}
                title={rollbackBlockedReason || t('tasks.revert_help')}
              >
                <RotateCcw size={15} aria-hidden="true" />
                {rollbackAction.label}
              </button>
              {rollbackBlockedReason ? (
                <span className="task-action-blocked" role="note">
                  {rollbackBlockedReason}
                </span>
              ) : null}
            </div>
          ) : null}

          {forwardActions.length > 0 ? (
            <div className="task-action-group task-action-group-next">
              <span className="task-action-group-label">{t('tasks.next_step')}</span>
              {forwardActions.map((action) => (
                <button
                  key={action.status}
                  className={`btn ${action.color} btn-sm`}
                  onClick={() => {
                    if (
                      action.status === 'in_review' &&
                      task.status === 'in_studio' &&
                      !submissionNotes.trim()
                    ) {
                      addToast(t('tasks.review_note_required'), 'error');
                      focusSubmissionNotes();
                      return;
                    }
                    setConfirmingAction(action);
                  }}
                  disabled={saving}
                >
                  <span aria-hidden="true">{STATUS_CONFIG[action.status].icon}</span>
                  {action.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
