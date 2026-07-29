import {
  ADMIN_VERDICTS,
  MEMBER_VERDICTS,
  type AdminVerdict,
  type MemberVerdict,
  type Task,
  type TaskStatus,
  type User,
} from './types';

// ═══════════════════════════════════════════════════════════════════════════
// The workflow, in one place.
//
// This table is mirrored by public.task_transitions and the
// enforce_task_transition() trigger in supabase/migrations. The UI derives its
// buttons from here; the database refuses anything that is not in there. Change
// one and change the other.
// ═══════════════════════════════════════════════════════════════════════════

export type Actor = 'admin' | 'assignee';

/** forward = onward through the pipeline, back = undo a step, sideways = fix a recorded fact. */
export type TransitionKind = 'forward' | 'back' | 'sideways';

/**
 * Confirm only when an action is irreversible, affects another person, or moves
 * money. Everything else acts immediately and offers Undo, which is faster to
 * use and safer to get wrong.
 */
export type ConfirmLevel = 'none' | 'simple' | 'destructive';

export interface Transition {
  from: TaskStatus;
  to: TaskStatus;
  by: readonly Actor[];
  kind: TransitionKind;
  confirm: ConfirmLevel;
  labelKey: string;
  /** Body copy for the confirmation, when this move asks for one. */
  confirmKey?: string;
  /** Returns an i18n key explaining why this move is unavailable right now. */
  blockedBy?: (task: Task) => string | null;
}

const BOTH: readonly Actor[] = ['admin', 'assignee'];
const ADMIN_ONLY: readonly Actor[] = ['admin'];

const paidBlocksReopen = (task: Task) =>
  task.payment_status === 'paid' ? 'tasks.revert_payment_blocked' : null;

const needsReviewNote = (task: Task) =>
  task.submission_notes.trim() ? null : 'tasks.review_note_required';

export const TRANSITIONS: readonly Transition[] = [
  // ── Picking the work up and putting it back down ──
  { from: 'assigned', to: 'working', by: BOTH, kind: 'forward', confirm: 'none', labelKey: 'tasks.claim' },
  { from: 'working', to: 'assigned', by: BOTH, kind: 'back', confirm: 'none', labelKey: 'tasks.release' },

  // ── Recording a verdict ──
  { from: 'working', to: 'swf', by: BOTH, kind: 'forward', confirm: 'none', labelKey: 'tasks.set_swf' },
  { from: 'working', to: 'swof', by: BOTH, kind: 'forward', confirm: 'none', labelKey: 'tasks.set_swof' },
  { from: 'working', to: 'member_discarded', by: BOTH, kind: 'forward', confirm: 'destructive', labelKey: 'tasks.discard', confirmKey: 'tasks.confirm_discard' },

  // ── Taking a verdict back ──
  { from: 'swf', to: 'working', by: BOTH, kind: 'back', confirm: 'none', labelKey: 'tasks.reopen_work' },
  { from: 'swof', to: 'working', by: BOTH, kind: 'back', confirm: 'none', labelKey: 'tasks.reopen_work' },
  { from: 'member_discarded', to: 'working', by: BOTH, kind: 'back', confirm: 'none', labelKey: 'tasks.reopen_work' },

  // ── Correcting a verdict without losing the submission ──
  // The move admins could not make before: SWF and SWOF are recorded facts, so
  // they can be corrected in place rather than by winding the task backwards.
  { from: 'swf', to: 'swof', by: BOTH, kind: 'sideways', confirm: 'none', labelKey: 'tasks.correct_to_swof' },
  { from: 'swof', to: 'swf', by: BOTH, kind: 'sideways', confirm: 'none', labelKey: 'tasks.correct_to_swf' },
  { from: 'swf', to: 'member_discarded', by: BOTH, kind: 'sideways', confirm: 'destructive', labelKey: 'tasks.correct_to_discarded', confirmKey: 'tasks.confirm_discard' },
  { from: 'swof', to: 'member_discarded', by: BOTH, kind: 'sideways', confirm: 'destructive', labelKey: 'tasks.correct_to_discarded', confirmKey: 'tasks.confirm_discard' },
  { from: 'member_discarded', to: 'swf', by: BOTH, kind: 'sideways', confirm: 'none', labelKey: 'tasks.correct_to_swf' },
  { from: 'member_discarded', to: 'swof', by: BOTH, kind: 'sideways', confirm: 'none', labelKey: 'tasks.correct_to_swof' },

  // ── Admin pipeline ──
  { from: 'swf', to: 'in_studio', by: ADMIN_ONLY, kind: 'forward', confirm: 'none', labelKey: 'tasks.claim_studio' },
  { from: 'swof', to: 'in_studio', by: ADMIN_ONLY, kind: 'forward', confirm: 'none', labelKey: 'tasks.claim_studio' },
  { from: 'member_discarded', to: 'in_studio', by: ADMIN_ONLY, kind: 'forward', confirm: 'none', labelKey: 'tasks.claim_studio' },
  { from: 'swf', to: 'on_hold', by: ADMIN_ONLY, kind: 'forward', confirm: 'none', labelKey: 'tasks.put_on_hold' },
  { from: 'swof', to: 'on_hold', by: ADMIN_ONLY, kind: 'forward', confirm: 'none', labelKey: 'tasks.put_on_hold' },
  { from: 'member_discarded', to: 'on_hold', by: ADMIN_ONLY, kind: 'forward', confirm: 'none', labelKey: 'tasks.put_on_hold' },

  { from: 'on_hold', to: 'in_studio', by: ADMIN_ONLY, kind: 'forward', confirm: 'none', labelKey: 'tasks.claim_studio' },
  { from: 'on_hold', to: 'swf', by: ADMIN_ONLY, kind: 'back', confirm: 'none', labelKey: 'tasks.back_to_swf' },
  { from: 'on_hold', to: 'swof', by: ADMIN_ONLY, kind: 'back', confirm: 'none', labelKey: 'tasks.back_to_swof' },
  { from: 'on_hold', to: 'member_discarded', by: ADMIN_ONLY, kind: 'back', confirm: 'none', labelKey: 'tasks.back_to_discarded' },
  // Escape hatch for rows that reached on_hold without a recorded verdict.
  { from: 'on_hold', to: 'working', by: ADMIN_ONLY, kind: 'back', confirm: 'none', labelKey: 'tasks.reopen_work' },

  {
    from: 'in_studio',
    to: 'in_review',
    by: ADMIN_ONLY,
    kind: 'forward',
    confirm: 'simple',
    labelKey: 'tasks.submit_for_review',
    confirmKey: 'tasks.submit_for_review_confirm',
    blockedBy: needsReviewNote,
  },
  { from: 'in_studio', to: 'on_hold', by: ADMIN_ONLY, kind: 'back', confirm: 'none', labelKey: 'tasks.put_on_hold' },
  { from: 'in_studio', to: 'swf', by: ADMIN_ONLY, kind: 'back', confirm: 'none', labelKey: 'tasks.back_to_swf' },
  { from: 'in_studio', to: 'swof', by: ADMIN_ONLY, kind: 'back', confirm: 'none', labelKey: 'tasks.back_to_swof' },
  { from: 'in_studio', to: 'member_discarded', by: ADMIN_ONLY, kind: 'back', confirm: 'none', labelKey: 'tasks.back_to_discarded' },

  // ── Review decisions: each one lands on somebody else, so each one confirms ──
  { from: 'in_review', to: 'approved', by: ADMIN_ONLY, kind: 'forward', confirm: 'simple', labelKey: 'tasks.approve', confirmKey: 'tasks.confirm_approve' },
  { from: 'in_review', to: 'sent_back', by: ADMIN_ONLY, kind: 'forward', confirm: 'simple', labelKey: 'tasks.send_back', confirmKey: 'tasks.confirm_send_back' },
  { from: 'in_review', to: 'admin_discarded', by: ADMIN_ONLY, kind: 'forward', confirm: 'destructive', labelKey: 'tasks.reject', confirmKey: 'tasks.confirm_reject' },
  { from: 'in_review', to: 'in_studio', by: ADMIN_ONLY, kind: 'back', confirm: 'none', labelKey: 'tasks.back_to_studio' },

  // ── Reopening a decision ──
  {
    from: 'approved',
    to: 'in_review',
    by: ADMIN_ONLY,
    kind: 'back',
    confirm: 'simple',
    labelKey: 'tasks.reopen_review',
    confirmKey: 'tasks.confirm_reopen_approved',
    blockedBy: paidBlocksReopen,
  },
  { from: 'sent_back', to: 'in_review', by: ADMIN_ONLY, kind: 'back', confirm: 'none', labelKey: 'tasks.reopen_review' },
  { from: 'admin_discarded', to: 'in_review', by: ADMIN_ONLY, kind: 'back', confirm: 'none', labelKey: 'tasks.reopen_review' },

  // ── The member picks the work back up after a send-back ──
  { from: 'sent_back', to: 'working', by: BOTH, kind: 'forward', confirm: 'none', labelKey: 'tasks.resume' },
];

export function actorFor(task: Task, user: User | null): Actor | null {
  if (!user) return null;
  if (user.role === 'admin') return 'admin';
  return task.assigned_to === user.id ? 'assignee' : null;
}

export function findTransition(
  from: TaskStatus,
  to: TaskStatus,
  actor: Actor | null
): Transition | undefined {
  if (!actor) return undefined;
  return TRANSITIONS.find(
    (item) => item.from === from && item.to === to && item.by.includes(actor)
  );
}

export function availableTransitions(task: Task, user: User | null): Transition[] {
  const actor = actorFor(task, user);
  if (!actor) return [];
  return TRANSITIONS.filter(
    (item) => item.from === task.status && item.by.includes(actor)
  );
}

/**
 * Field changes that ride along with a status change: verdicts recorded, admin
 * decisions cleared when a task is reopened, payment armed on approval. Keeping
 * them beside the transition table is what stops the rules drifting apart.
 */
export function transitionEffects(task: Task, to: TaskStatus): Partial<Task> {
  const now = new Date().toISOString();
  const effects: Partial<Task> = { status: to };

  const asMemberVerdict = MEMBER_VERDICTS.find((verdict) => verdict === to);
  if (asMemberVerdict) {
    effects.member_verdict = asMemberVerdict as MemberVerdict;
    // Only restamp when the verdict actually changes, so reverting from Studio
    // back to SWF keeps the date the member originally submitted on.
    if (task.member_verdict !== asMemberVerdict) effects.member_verdict_date = now;
  }

  if (to === 'working') {
    effects.member_verdict = '';
    effects.member_verdict_date = '';
  }

  const asAdminVerdict = ADMIN_VERDICTS.find((verdict) => verdict === to);
  if (asAdminVerdict) {
    effects.admin_verdict = asAdminVerdict as AdminVerdict;
    effects.admin_verdict_date = now;
  }

  if (to === 'approved') {
    effects.payment_status = 'pending';
  }

  // Reopening a decision retracts it, and un-arms the payment it created.
  if (to === 'in_review') {
    effects.admin_verdict = '';
    effects.admin_verdict_date = '';
    if (task.status === 'approved') {
      effects.payment_status = 'not_applicable';
      effects.payment_date = '';
    }
  }

  return effects;
}

/**
 * The exact patch that puts a task back the way it was. Built by diffing the
 * before/after snapshots rather than by recomputing a reverse transition, so an
 * Undo restores the original verdict dates and payment state precisely.
 */
const REVERSIBLE_FIELDS = [
  'status',
  'assigned_to',
  'member_verdict',
  'member_verdict_date',
  'admin_verdict',
  'admin_verdict_date',
  'payment_status',
  'payment_date',
  'payment_amount_usd',
] as const;

export function undoPatch(before: Task, after: Task): Partial<Task> {
  const patch: Partial<Task> = {};
  for (const field of REVERSIBLE_FIELDS) {
    if (before[field] !== after[field]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (patch as any)[field] = before[field];
    }
  }
  return patch;
}

/** An Undo is only offered when the reverse move is legal for this actor too. */
export function canUndo(before: Task, after: Task, user: User | null): boolean {
  if (before.status === after.status) return true;
  return Boolean(findTransition(after.status, before.status, actorFor(after, user)));
}

// ─── Stages ──────────────────────────────────────────────────────────────────

export type Stage = 'submission' | 'studio' | 'review' | 'payment';

export const STAGES: readonly Stage[] = ['submission', 'studio', 'review', 'payment'];

export const STAGE_OF_STATUS: Record<TaskStatus, Stage> = {
  assigned: 'submission',
  working: 'submission',
  swf: 'submission',
  swof: 'submission',
  member_discarded: 'submission',
  on_hold: 'studio',
  in_studio: 'studio',
  in_review: 'review',
  sent_back: 'review',
  admin_discarded: 'review',
  approved: 'payment',
};

/** How far a task has travelled, for enabling the stage tabs behind it. */
export function stageRank(status: TaskStatus): number {
  return STAGES.indexOf(STAGE_OF_STATUS[status]);
}

/** Terminal outcomes render as a broken chain, not a completed one. */
export function isNegativeOutcome(status: TaskStatus): boolean {
  return status === 'member_discarded' || status === 'admin_discarded';
}

// ─── Editing rights ──────────────────────────────────────────────────────────

// Members draft the prompt and DSP while they are still working, not after the
// verdict, so the shared fields open at 'working' rather than at 'swf'.
const SUBMISSION_EDITABLE: readonly TaskStatus[] = [
  'working',
  'swf',
  'swof',
  'member_discarded',
  'on_hold',
  'in_studio',
  'sent_back',
];

export function canEditSubmission(task: Task, user: User | null): boolean {
  return Boolean(actorFor(task, user)) && SUBMISSION_EDITABLE.includes(task.status);
}
