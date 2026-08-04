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

export const MEMBER_ACTIVE_STATUSES: readonly TaskStatus[] = [
  'working',
  'sent_back',
  'swf',
  'swof',
  'member_discarded',
  'on_hold',
  'in_studio',
  'in_review',
];

export type PaymentStatus = 'not_applicable' | 'pending' | 'paid';

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
  /**
   * Granted by an admin, one member at a time, and enforced by the insert
   * policy on announcement_replies rather than by this flag. Admins always may.
   */
  can_reply_announcements?: boolean;
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
  submission_prompt: string;
  submission_dsp: string;
  submission_final_answer: string;
  submission_notes: string;
  studio_result: string;
  payment_status: PaymentStatus;
  payment_amount_usd: number;
  payment_date: string;
  deleted_at: string | null;
  deleted_by: string | null;
  created: string;
  updated: string;
  // Expanded relation
  expand?: {
    assigned_to?: User;
  };
}

// ─── Settings ────────────────────────────────────────────────────────────────

export interface AppSettings {
  id: string;
  usd_to_irr_rate: number;
  updated: string;
}

// ─── Announcements ───────────────────────────────────────────────────────────

export type AnnouncementLevel = 'info' | 'warning' | 'critical';

export interface Announcement {
  id: string;
  body: string;
  level: AnnouncementLevel;
  /** null addresses the whole team; otherwise the one member who sees it. */
  target_user_id: string | null;
  created_by: string | null;
  created: string;
  /** Stamped by the database on every edit; dismissal keys on it. */
  updated: string;
}

export interface AnnouncementReply {
  id: string;
  announcement_id: string;
  author_id: string;
  body: string;
  created: string;
}

// ─── Saved Prompts ──────────────────────────────────────────────────────────

export type PromptVisibility = 'public' | 'personal';

export interface SavedPrompt {
  id: string;
  title: string;
  body: string;
  visibility: PromptVisibility;
  owner_id: string | null;
  created_by: string | null;
  created: string;
  updated: string;
}

// ─── UI Types ────────────────────────────────────────────────────────────────

export type Language = 'en' | 'fa';

/**
 * Presentation only. Labels deliberately live in src/i18n/*.json and nowhere
 * else: this record used to carry its own `label`/`labelFa`, so a badge said
 * "ارسال با خطا" while a dialog on the same screen said "SWF".
 */
export interface StatusStyle {
  color: string;
  bgColor: string;
  icon: string;
}

export const STATUS_CONFIG: Record<TaskStatus, StatusStyle> = {
  assigned: { color: '#334155', bgColor: '#F1F5F9', icon: '📋' },
  working: { color: '#075985', bgColor: '#E0F2FE', icon: '⚡' },
  // SWF — a flaw was found, which is the goal of the work, so it reads positive.
  swf: { color: '#166534', bgColor: '#DCFCE7', icon: '🎯' },
  swof: { color: '#854D0E', bgColor: '#FEF9C3', icon: '⚪' },
  member_discarded: { color: '#991B1B', bgColor: '#FDF2F2', icon: '🗑️' },
  on_hold: { color: '#3F3F46', bgColor: '#F4F4F5', icon: '⏸️' },
  in_studio: { color: '#581C87', bgColor: '#F3E8FF', icon: '🎬' },
  in_review: { color: '#075985', bgColor: '#E0F2FE', icon: '🔍' },
  approved: { color: '#14532D', bgColor: '#E6F4EA', icon: '✅' },
  sent_back: { color: '#9A3412', bgColor: '#FFEDD5', icon: '↩️' },
  admin_discarded: { color: '#991B1B', bgColor: '#FDF2F2', icon: '❌' },
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

