import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import type { Task } from '../../../types';
import { useAppStore, useAuthStore, useLanguageStore } from '../../../store';
import StatusBadge from '../../shared/StatusBadge';
import CopyButton from '../../shared/CopyButton';
import ConfirmDialog, { type ConfirmTone } from '../../shared/ConfirmDialog';
import StatusGlossary from '../StatusGlossary';
import VerdictChip from '../VerdictChip';
import {
  actorFor,
  availableTransitions,
  canEditSubmission,
  stageRank,
  transitionEffects,
  STAGE_OF_STATUS,
  type Stage,
  type Transition,
} from '../../../workflow';
import LifecycleStepper from './LifecycleStepper';
import TaskContextPane from './TaskContextPane';
import StageTabs from './StageTabs';
import SubmissionPanel from './SubmissionPanel';
import StudioPanel from './StudioPanel';
import ReviewPanel from './ReviewPanel';
import PaymentPanel from './PaymentPanel';
import TaskHistory from './TaskHistory';
import ActionBar from './ActionBar';
import useTaskDraft from './useTaskDraft';
import useTaskActions from './useTaskActions';
import { formatCurrency } from '../../../utils/dates';

interface Props {
  task: Task;
  onClose: () => void;
}

type PendingConfirm = {
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  tone: ConfirmTone;
  typeToConfirm?: string;
  run: () => unknown;
};

export default function TaskWorkspace({ task, onClose }: Props) {
  const { user } = useAuthStore();
  const { t, language } = useLanguageStore();
  const { members, settings } = useAppStore();
  const isAdmin = user?.role === 'admin';

  const { apply, saving } = useTaskActions(task, onClose);
  const editable = canEditSubmission(task, user);

  // The draft hook writes on its own; this is the writer it calls.
  const persistDraft = useCallback(
    (patch: Partial<Task>, baseUpdated: string) =>
      apply(patch, { silent: true, expectedUpdated: baseUpdated }),
    [apply]
  );

  const draft = useTaskDraft(task, { canEdit: editable, onSave: persistDraft });
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null);

  const [stage, setStage] = useState<Stage>(() => STAGE_OF_STATUS[task.status]);
  const followStatusRef = useRef(task.status);

  // The tab opens on the task's own stage and stays wherever the user puts it,
  // moving again only when the status itself moves.
  useEffect(() => {
    if (followStatusRef.current !== task.status) {
      followStatusRef.current = task.status;
      setStage(STAGE_OF_STATUS[task.status]);
    }
  }, [task.status]);

  const assignableMembers = useMemo(
    () => members.filter((member) => member.role === 'member' && member.is_active),
    [members]
  );

  const transitions = availableTransitions(task, user);
  const reached = stageRank(task.status);

  const lockedStages: Partial<Record<Stage, string>> = {};
  if (reached < 1) lockedStages.studio = t('tasks.unlocks_after_submission');
  if (reached < 2) lockedStages.review = t('tasks.unlocks_after_studio');

  const actionableStage = transitions.some((item) => item.kind === 'forward')
    ? STAGE_OF_STATUS[task.status]
    : null;

  const dirtyStages: Stage[] = [];
  if (draft.dirty) {
    const patch = draft.patch();
    if (
      'submission_prompt' in patch ||
      'submission_dsp' in patch ||
      'submission_final_answer' in patch ||
      'submission_notes' in patch
    ) {
      dirtyStages.push('submission');
    }
    if ('studio_result' in patch || 'submission_notes' in patch) dirtyStages.push('studio');
  }

  // ── Leaving with work that failed to save ─────────────────────────────────
  // Edits are written about a second after typing stops, so 'dirty' is normally
  // a blink. Only an actual save failure is worth interrupting somebody over.
  const atRisk = draft.dirty && draft.saveState === 'error';

  useEffect(() => {
    if (!atRisk) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [atRisk]);

  const handleClose = useCallback(() => {
    if (!atRisk) {
      onClose();
      return;
    }
    setConfirm({
      title: t('tasks.leave_unsaved_title'),
      body: <p>{t('tasks.leave_unsaved_help')}</p>,
      confirmLabel: t('tasks.leave_anyway'),
      tone: 'warning',
      run: onClose,
    });
  }, [atRisk, onClose, t]);

  // ── Moving the task ────────────────────────────────────────────────────────
  const runTransition = useCallback(
    async (transition: Transition) => {
      const patch: Partial<Task> = {
        ...transitionEffects(task, transition.to),
        // A transition carries any unsaved edits with it; the confirm copy and
        // the action bar both say so rather than letting it happen invisibly.
        ...(editable ? draft.patch() : {}),
      };

      const updated = await apply(patch, {
        success: `${t('tasks.status_updated')} ${t(`status.${transition.to}`)}`,
        error: t('tasks.status_update_error'),
        undoLabel: t('common.undo'),
        expectedUpdated: draft.dirty ? draft.baseUpdated : task.updated,
      });
      if (updated) draft.markSaved(updated);
    },
    [apply, draft, editable, t, task]
  );

  const requestTransition = useCallback(
    (transition: Transition) => {
      const blockedKey = transition.blockedBy?.(task);
      if (blockedKey) return;

      if (transition.confirm === 'none') {
        void runTransition(transition);
        return;
      }

      setConfirm({
        title: t(transition.labelKey),
        tone: transition.confirm === 'destructive' ? 'danger' : 'default',
        confirmLabel: t(transition.labelKey),
        body: (
          <>
            <p className="confirm-copy">
              {transition.confirmKey
                ? t(transition.confirmKey)
                : t('tasks.confirm_generic').replace('{task}', task.task_id)}
            </p>
            <div className="task-status-transition" aria-label={t('tasks.status_change')}>
              <StatusBadge status={task.status} />
              <span aria-hidden="true">→</span>
              <StatusBadge status={transition.to} />
            </div>
            {draft.dirty && editable && (
              <p className="confirm-note">{t('tasks.unsaved_included')}</p>
            )}
          </>
        ),
        run: () => runTransition(transition),
      });
    },
    [draft.dirty, editable, runTransition, t, task]
  );

  // ── Side actions ───────────────────────────────────────────────────────────
  const requestReassign = useCallback(
    (memberId: string) => {
      if (memberId === task.assigned_to) return;
      const target = members.find((member) => member.id === memberId);
      setConfirm({
        title: t('tasks.reassign'),
        tone: 'warning',
        confirmLabel: t('tasks.reassign'),
        body: (
          <p className="confirm-copy">
            {t('tasks.reassign_confirm')
              .replace('{task}', task.task_id)
              .replace('{from}', task.expand?.assigned_to?.name || '—')
              .replace('{to}', target?.name || '—')}
          </p>
        ),
        run: () =>
          apply({ assigned_to: memberId }, {
            success: t('tasks.reassigned'),
            error: t('tasks.reassign_error'),
            undoLabel: t('common.undo'),
          }),
      });
    },
    [apply, members, t, task]
  );

  const saveNotes = useCallback(
    async (notes: string) =>
      apply({ admin_notes: notes }, {
        success: t('tasks.notes_saved'),
        error: t('tasks.notes_save_error'),
      }),
    [apply, t]
  );

  const saveAmount = useCallback(
    async (usd: number) => {
      await apply({ payment_amount_usd: usd }, {
        success: t('payments.amount_saved'),
        error: t('payments.amount_save_error'),
        undoLabel: t('common.undo'),
      });
    },
    [apply, t]
  );

  const requestMarkPaid = useCallback(
    (usd: number) => {
      setConfirm({
        title: t('payments.mark_paid'),
        tone: 'default',
        confirmLabel: t('payments.mark_paid'),
        body: (
          <p className="confirm-copy">
            {t('payments.mark_paid_confirm')
              .replace('{task}', task.task_id)
              .replace('{amount}', formatCurrency(usd, 'USD', language))
              .replace('{member}', task.expand?.assigned_to?.name || '—')}
          </p>
        ),
        run: () =>
          apply(
            {
              payment_status: 'paid',
              payment_date: new Date().toISOString(),
              payment_amount_usd: usd,
            },
            {
              success: t('payments.marked_paid'),
              error: t('payments.mark_paid_error'),
              undoLabel: t('common.undo'),
            }
          ),
      });
    },
    [apply, language, t, task]
  );

  const requestRevertPayment = useCallback(() => {
    setConfirm({
      title: t('payments.revert_pending'),
      tone: 'warning',
      confirmLabel: t('payments.revert_pending'),
      body: <p className="confirm-copy">{t('payments.revert_confirm')}</p>,
      run: () =>
        apply({ payment_status: 'pending', payment_date: '' }, {
          success: t('payments.reverted_pending'),
          error: t('payments.revert_error'),
          undoLabel: t('common.undo'),
        }),
    });
  }, [apply, t]);

  if (!actorFor(task, user)) return null;

  return (
    <div className="task-workspace" role="region" aria-label={task.task_id}>
      <header className="task-workspace-header">
        <button
          type="button"
          className="btn btn-ghost btn-sm task-workspace-back"
          onClick={handleClose}
        >
          <ArrowLeft className="task-workspace-back-icon" size={16} aria-hidden="true" />
          {t('common.back')}
        </button>
        <div className="task-workspace-title">
          <span className="task-id">{task.task_id}</span>
          <CopyButton
            text={task.task_id}
            compact
            ariaLabel={`${t('common.copy')}: ${t('tasks.task_id')}`}
          />
          <StatusBadge status={task.status} />
          <VerdictChip task={task} />
          <StatusGlossary status={task.member_verdict || task.status} />
        </div>
      </header>

      <LifecycleStepper
        status={task.status}
        verdict={task.member_verdict}
        activeStage={stage}
        onSelectStage={setStage}
      />

      <div className="task-workspace-body">
        <TaskContextPane
          task={task}
          isAdmin={Boolean(isAdmin)}
          assignableMembers={assignableMembers}
          onRequestReassign={requestReassign}
          saving={saving}
        />

        <div className="task-workspace-stage">
          <StageTabs
            active={stage}
            onSelect={setStage}
            lockedStages={lockedStages}
            actionableStage={actionableStage}
            dirtyStages={dirtyStages}
          />

          <div
            className="stage-panel-shell"
            role="tabpanel"
            id={`stage-panel-${stage}`}
            aria-labelledby={`stage-tab-${stage}`}
            tabIndex={-1}
          >
            {stage === 'submission' && (
              <SubmissionPanel
                task={task}
                draft={draft.draft}
                setField={draft.setField}
                canEdit={editable}
                dirty={draft.dirty}
                remoteChanged={draft.remoteChanged}
                onLoadLatest={draft.loadLatest}
                saveState={draft.saveState}
                lastSavedAt={draft.lastSavedAt}
                onRetrySave={() => void draft.saveNow()}
                saving={saving}
              />
            )}
            {stage === 'studio' && (
              <StudioPanel
                task={task}
                draft={draft.draft}
                setField={draft.setField}
                canEdit={editable && Boolean(isAdmin)}
                isAdmin={Boolean(isAdmin)}
                dirty={draft.dirty}
                saveState={draft.saveState}
                lastSavedAt={draft.lastSavedAt}
                onRetrySave={() => void draft.saveNow()}
              />
            )}
            {stage === 'review' && (
              <ReviewPanel
                task={task}
                isAdmin={Boolean(isAdmin)}
                onSaveNotes={saveNotes}
              />
            )}
            {stage === 'payment' && (
              <PaymentPanel
                task={task}
                isAdmin={Boolean(isAdmin)}
                settings={settings}
                onSaveAmount={saveAmount}
                onRequestMarkPaid={requestMarkPaid}
                onRequestRevert={requestRevertPayment}
                saving={saving}
              />
            )}
          </div>

          <TaskHistory taskId={task.id} revision={task.updated} />
        </div>
      </div>

      <ActionBar
        task={task}
        transitions={transitions}
        onRun={requestTransition}
        saving={saving}
        dirty={draft.dirty && editable}
      />

      <ConfirmDialog
        open={Boolean(confirm)}
        title={confirm?.title || ''}
        confirmLabel={confirm?.confirmLabel || t('common.confirm')}
        tone={confirm?.tone}
        typeToConfirm={confirm?.typeToConfirm}
        busy={saving}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          const pending = confirm;
          setConfirm(null);
          await pending?.run();
        }}
      >
        {confirm?.body}
      </ConfirmDialog>
    </div>
  );
}
