// ─── Task Statuses ───────────────────────────────────────────────────────────

export const MEMBER_VERDICTS = ['swf', 'swof', 'member_discarded'] as const;
export type MemberVerdict = (typeof MEMBER_VERDICTS)[number];

export const ADMIN_VERDICTS = ['approved', 'sent_back', 'admin_discarded'] as const;
export type AdminVerdict = (typeof ADMIN_VERDICTS)[number];

export const TASK_STATUSES = [
  'assigned',
  'working',
  'swf',
  'swof',
  'member_discarded',
  'on_hold',
  'in_studio',
  'in_review',
  'approved',
  'sent_back',
  'admin_discarded',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const PAYMENT_STATUSES = ['not_applicable', 'pending', 'paid'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

// ─── User ────────────────────────────────────────────────────────────────────

export type UserRole = 'admin' | 'member';

export interface User {
  id: string;
  username: string;
  email: string;
  name: string;
  role: UserRole;
  avatar: string;
  is_active: boolean;
  created: string;
  updated: string;
}

// ─── Task ────────────────────────────────────────────────────────────────────

export interface Task {
  id: string;
  task_id: string; // Mercor task ID — unique across all members
  body: string;
  assigned_to: string; // relation → users.id
  status: TaskStatus;
  member_verdict: MemberVerdict | '';
  member_verdict_date: string;
  admin_verdict: AdminVerdict | '';
  admin_verdict_date: string;
  admin_notes: string;
  payment_status: PaymentStatus;
  payment_amount_usd: number;
  payment_date: string;
  created: string;
  updated: string;
  // Expanded relation
  expand?: {
    assigned_to?: User;
  };
}

// ─── Activity Log ────────────────────────────────────────────────────────────

export type ActivityAction =
  | 'task_created'
  | 'task_assigned'
  | 'task_claimed'
  | 'task_verdict_swf'
  | 'task_verdict_swof'
  | 'task_verdict_discarded'
  | 'task_in_studio'
  | 'task_on_hold'
  | 'task_in_review'
  | 'task_approved'
  | 'task_sent_back'
  | 'task_admin_discarded'
  | 'task_reassigned'
  | 'task_paid'
  | 'user_created'
  | 'user_updated';

export interface ActivityLog {
  id: string;
  user: string;
  task: string;
  action: ActivityAction;
  details: string;
  created: string;
  expand?: {
    user?: User;
    task?: Task;
  };
}

// ─── Settings ────────────────────────────────────────────────────────────────

export interface AppSettings {
  id: string;
  usd_to_irr_rate: number;
  updated: string;
}

// ─── UI Types ────────────────────────────────────────────────────────────────

export type Language = 'en' | 'fa';
export type Theme = 'light' | 'dark';

export interface StatusConfig {
  key: TaskStatus;
  label: string;
  labelFa: string;
  color: string;
  bgColor: string;
  icon: string;
}

export const STATUS_CONFIG: Record<TaskStatus, StatusConfig> = {
  assigned: {
    key: 'assigned',
    label: 'Assigned',
    labelFa: 'تخصیص داده شده',
    color: '#475569',
    bgColor: '#F1F5F9',
    icon: '📋',
  },
  working: {
    key: 'working',
    label: 'Working',
    labelFa: 'در حال کار',
    color: '#0369A1',
    bgColor: '#E0F2FE',
    icon: '⚡',
  },
  swf: {
    key: 'swf',
    label: 'SWF',
    labelFa: 'ارسال با خطا',
    color: '#B45309',
    bgColor: '#FEF3C7',
    icon: '⚠️',
  },
  swof: {
    key: 'swof',
    label: 'SWOF',
    labelFa: 'ارسال بدون خطا',
    color: '#15803D',
    bgColor: '#EEF7EE',
    icon: '✅',
  },
  member_discarded: {
    key: 'member_discarded',
    label: 'Discarded',
    labelFa: 'رد شده',
    color: '#B91C1C',
    bgColor: '#FDF2F2',
    icon: '🗑️',
  },
  on_hold: {
    key: 'on_hold',
    label: 'On Hold',
    labelFa: 'در انتظار',
    color: '#52525B',
    bgColor: '#F4F4F5',
    icon: '⏸️',
  },
  in_studio: {
    key: 'in_studio',
    label: 'In Studio',
    labelFa: 'در استودیو',
    color: '#6D28D9',
    bgColor: '#F3E8FF',
    icon: '🎬',
  },
  in_review: {
    key: 'in_review',
    label: 'In Review',
    labelFa: 'در حال بررسی',
    color: '#0284C7',
    bgColor: '#E0F2FE',
    icon: '🔍',
  },
  approved: {
    key: 'approved',
    label: 'Approved',
    labelFa: 'تأیید شده',
    color: '#15803D',
    bgColor: '#E6F4EA',
    icon: '🌟',
  },
  sent_back: {
    key: 'sent_back',
    label: 'Sent Back',
    labelFa: 'بازگشت برای ویرایش',
    color: '#C2410C',
    bgColor: '#FFEDD5',
    icon: '↩️',
  },
  admin_discarded: {
    key: 'admin_discarded',
    label: 'Rejected',
    labelFa: 'رد شده توسط مدیر',
    color: '#B91C1C',
    bgColor: '#FDF2F2',
    icon: '❌',
  },
};

// ─── Dashboard Stats ─────────────────────────────────────────────────────────

export interface MemberStats {
  userId: string;
  name: string;
  totalTasks: number;
  assigned: number;
  working: number;
  swf: number;
  swof: number;
  memberDiscarded: number;
  inStudio: number;
  inReview: number;
  approved: number;
  sentBack: number;
  adminDiscarded: number;
  onHold: number;
  totalPaidUsd: number;
  totalPendingUsd: number;
}

// ─── Duplicate Check Result ──────────────────────────────────────────────────

export interface DuplicateCheckResult {
  isDuplicate: boolean;
  existingTask?: Task;
  assignedToName?: string;
}
