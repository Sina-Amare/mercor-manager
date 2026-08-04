import type { Task, TaskStatus, User } from './types';

/**
 * The named piles of work people actually think in.
 *
 * Filtering by status already worked, but it made you go and look. A queue is
 * the same filter given a name, a permanent home in the sidebar and a live
 * count, so "has anything new landed on me" is answered without opening
 * anything. Admins and members are shown different piles because they are
 * waiting on different things.
 *
 * The vocabulary is deliberate. Recording SWF or SWOF means the member has
 * finished working on the task — it does not mean anything reached Studio, and
 * calling that pile "Submitted" implied a handover that had not happened.
 * "Submitted" is reserved for work an admin has sent out of Studio into Review.
 */
export interface Queue {
  id: string;
  labelKey: string;
  helpKey: string;
  statuses: readonly TaskStatus[];
  audience: 'admin' | 'member';
  /** Narrows further by settlement, for the payment queues. */
  payment?: 'paid' | 'unpaid';
  /** Piles that are waiting on this person, rather than on somebody else. */
  needsAction?: boolean;
}

export const QUEUES: readonly Queue[] = [
  // ── A member: what is on me ──
  {
    id: 'new',
    labelKey: 'queues.new',
    helpKey: 'queues.new_help',
    statuses: ['assigned'],
    audience: 'member',
    needsAction: true,
  },
  {
    id: 'returned',
    labelKey: 'queues.returned',
    helpKey: 'queues.returned_help',
    statuses: ['sent_back'],
    audience: 'member',
    needsAction: true,
  },
  {
    id: 'in-progress',
    labelKey: 'queues.in_progress',
    helpKey: 'queues.in_progress_help',
    statuses: ['working'],
    audience: 'member',
  },
  {
    id: 'completed',
    labelKey: 'queues.completed',
    helpKey: 'queues.completed_help',
    statuses: ['swf', 'swof', 'member_discarded'],
    audience: 'member',
  },

  // ── A member: where it is once it leaves them ──
  {
    id: 'member-in-studio',
    labelKey: 'queues.member_in_studio',
    helpKey: 'queues.member_in_studio_help',
    statuses: ['on_hold', 'in_studio'],
    audience: 'member',
  },
  {
    id: 'member-in-review',
    labelKey: 'queues.member_in_review',
    helpKey: 'queues.member_in_review_help',
    statuses: ['in_review'],
    audience: 'member',
  },
  {
    id: 'member-approved',
    labelKey: 'queues.member_approved',
    helpKey: 'queues.member_approved_help',
    statuses: ['approved'],
    audience: 'member',
  },
  {
    id: 'member-rejected',
    labelKey: 'queues.member_rejected',
    helpKey: 'queues.member_rejected_help',
    statuses: ['admin_discarded'],
    audience: 'member',
  },

  // ── A member: money ──
  {
    id: 'member-awaiting-payment',
    labelKey: 'queues.awaiting_payment',
    helpKey: 'queues.awaiting_payment_help',
    statuses: ['approved'],
    payment: 'unpaid',
    audience: 'member',
  },
  {
    id: 'member-paid',
    labelKey: 'queues.paid',
    helpKey: 'queues.paid_help',
    statuses: ['approved'],
    payment: 'paid',
    audience: 'member',
  },

  // ── An admin: what is on me ──
  {
    id: 'awaiting-studio',
    labelKey: 'queues.awaiting_studio',
    helpKey: 'queues.awaiting_studio_help',
    statuses: ['swf', 'swof', 'member_discarded'],
    audience: 'admin',
    needsAction: true,
  },
  {
    id: 'in-review',
    labelKey: 'queues.in_review',
    helpKey: 'queues.in_review_help',
    statuses: ['in_review'],
    audience: 'admin',
    needsAction: true,
  },
  {
    id: 'in-studio',
    labelKey: 'queues.in_studio',
    helpKey: 'queues.in_studio_help',
    statuses: ['in_studio'],
    audience: 'admin',
  },
  {
    id: 'on-hold',
    labelKey: 'queues.on_hold',
    helpKey: 'queues.on_hold_help',
    statuses: ['on_hold'],
    audience: 'admin',
  },

  // ── An admin: what the team is doing ──
  {
    id: 'not-started',
    labelKey: 'queues.not_started',
    helpKey: 'queues.not_started_help',
    statuses: ['assigned'],
    audience: 'admin',
  },
  {
    id: 'active',
    labelKey: 'queues.active',
    helpKey: 'queues.active_help',
    statuses: ['working'],
    audience: 'admin',
  },

  // ── An admin: outcomes ──
  {
    id: 'approved',
    labelKey: 'queues.approved',
    helpKey: 'queues.approved_help',
    statuses: ['approved'],
    audience: 'admin',
  },
  {
    id: 'sent-back',
    labelKey: 'queues.sent_back',
    helpKey: 'queues.sent_back_help',
    statuses: ['sent_back'],
    audience: 'admin',
  },
  {
    id: 'rejected',
    labelKey: 'queues.rejected',
    helpKey: 'queues.rejected_help',
    statuses: ['admin_discarded'],
    audience: 'admin',
  },

  // ── An admin: money ──
  {
    id: 'awaiting-payment',
    labelKey: 'queues.awaiting_payment',
    helpKey: 'queues.awaiting_payment_admin_help',
    statuses: ['approved'],
    payment: 'unpaid',
    audience: 'admin',
    needsAction: true,
  },
  {
    id: 'paid',
    labelKey: 'queues.paid',
    helpKey: 'queues.paid_admin_help',
    statuses: ['approved'],
    payment: 'paid',
    audience: 'admin',
  },
];

export function queuesFor(user: User | null): Queue[] {
  if (!user) return [];
  const audience = user.role === 'admin' ? 'admin' : 'member';
  return QUEUES.filter((queue) => queue.audience === audience);
}

export function findQueue(id: string | undefined): Queue | undefined {
  return QUEUES.find((queue) => queue.id === id);
}

/** A member only ever counts their own work; an admin counts everything. */
export function tasksInQueue(queue: Queue, tasks: Task[], user: User | null): Task[] {
  return tasks.filter((task) => {
    if (!queue.statuses.includes(task.status)) return false;
    if (queue.payment === 'paid' && task.payment_status !== 'paid') return false;
    if (queue.payment === 'unpaid' && task.payment_status === 'paid') return false;
    if (user?.role !== 'admin' && task.assigned_to !== user?.id) return false;
    return true;
  });
}
