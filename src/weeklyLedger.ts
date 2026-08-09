import type { Task, User } from './types';

/**
 * The arithmetic behind the weekly ledger, with no React and no Supabase in
 * it, so it can be checked directly rather than through a browser.
 *
 * Two quantities are tracked separately all the way through, because in
 * practice they drift apart:
 *
 *   earned  — what the week's work is worth, tasks × hours_per_task
 *   logged  — what actually went into Insightful, one meter reading minus
 *             another
 *
 * `carryIn` is hours owed from earlier that never went through the tracker.
 * It is added to what is earned, so the total is what still has to be logged.
 * Whatever is left at the end of the week is what rolls into the next one.
 */

export const PROJECTS = ['agnus', 'chromium'] as const;
export type ProjectKey = (typeof PROJECTS)[number];

/** Fixed for now, editable per week — a rate change must not rewrite history. */
export const PROJECT_DEFAULTS: Record<ProjectKey, { hoursPerTask: number; usdPerTask: number }> = {
  agnus: { hoursPerTask: 2, usdPerTask: 4 },
  chromium: { hoursPerTask: 4, usdPerTask: 8 },
};

// ─── Week boundaries ─────────────────────────────────────────────────────────

/**
 * The Friday on or before a date.
 *
 * Built from the calendar fields rather than by subtracting milliseconds: on
 * the two days a year that clocks change, a day is not 24 hours long, and
 * `date - n * DAY_MS` lands an hour into the previous day. Constructing a new
 * local midnight sidesteps that entirely.
 */
export function fridayOnOrBefore(date: Date): Date {
  // getDay(): Sunday 0 … Friday 5 … Saturday 6.
  const back = (date.getDay() - 5 + 7) % 7;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - back);
}

/** The Friday starting the week that contains today. */
export function currentWeekKey(): string {
  return toDateKey(fridayOnOrBefore(new Date()));
}

/** `2026-08-07`, in local time — never `toISOString()`, which shifts to UTC. */
export function toDateKey(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Parses `2026-08-07` as local midnight. `new Date(str)` would parse it as UTC. */
export function fromDateKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

export const weekIdFor = (startsOn: string) => `week_${startsOn}`;

export function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/** The seven days of the week starting on `friday`. */
export function weekDays(friday: Date): Date[] {
  return Array.from({ length: 7 }, (_, index) => addDays(friday, index));
}

/**
 * Every week that touches a month, as Friday date keys, oldest first.
 *
 * "Touches" rather than "starts in": the week containing the 1st usually
 * starts in the previous month, and a calendar that hid it would leave the
 * first days of the month unreachable.
 */
export function weeksTouchingMonth(year: number, month: number): string[] {
  const first = fridayOnOrBefore(new Date(year, month, 1));
  const lastDay = new Date(year, month + 1, 0);
  const keys: string[] = [];
  for (let cursor = first; cursor <= lastDay; cursor = addDays(cursor, 7)) {
    keys.push(toDateKey(cursor));
  }
  return keys;
}

/** True when the date falls inside the Friday→Thursday week starting at `friday`. */
export function isInWeek(date: Date, friday: Date): boolean {
  const start = friday.getTime();
  const end = addDays(friday, 7).getTime();
  const time = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  return time >= start && time < end;
}

// ─── The Insightful meter ────────────────────────────────────────────────────

/**
 * Reads a cumulative meter written as `195:20`, `195`, or `195.5`.
 *
 * Returns null rather than 0 for anything unparseable, because "not recorded"
 * and "zero hours" have to stay distinguishable — treating a blank field as
 * zero would silently claim the week's whole debt had been logged.
 */
export function parseMeter(value: string): number | null {
  const text = value.trim();
  if (!text) return null;

  const colon = /^(\d+)\s*:\s*([0-5]?\d)$/.exec(text);
  if (colon) return Number(colon[1]) * 60 + Number(colon[2]);

  const decimal = /^(\d+)(?:[.,](\d+))?$/.exec(text);
  if (decimal) return Math.round(Number(text.replace(',', '.')) * 60);

  return null;
}

/** 11720 → `195:20`. */
export function formatMeter(minutes: number | null): string {
  if (minutes === null || !Number.isFinite(minutes)) return '';
  const sign = minutes < 0 ? '-' : '';
  const total = Math.abs(Math.round(minutes));
  return `${sign}${Math.floor(total / 60)}:${`${total % 60}`.padStart(2, '0')}`;
}

/** Hours to one decimal, for display next to money. */
export const minutesToHours = (minutes: number) => Math.round((minutes / 60) * 100) / 100;

// ─── Rows, as stored ─────────────────────────────────────────────────────────

export interface WorkWeek {
  id: string;
  starts_on: string;
  notes: string;
  created: string;
  updated: string;
}

export interface WorkWeekProject {
  week_id: string;
  project: ProjectKey;
  tasks_done: number;
  tasks_done_is_manual: boolean;
  hours_per_task: number;
  usd_per_task: number;
  carry_in_hours: number;
  tracker_start_minutes: number | null;
  tracker_end_minutes: number | null;
}

export interface WorkWeekMember {
  week_id: string;
  user_id: string;
  project: ProjectKey;
  tasks_done: number;
}

export interface WorkWeekBonus {
  id: string;
  week_id: string;
  user_id: string | null;
  project: ProjectKey;
  amount_usd: number;
  note: string;
  created: string;
}

export function emptyProject(weekId: string, project: ProjectKey): WorkWeekProject {
  return {
    week_id: weekId,
    project,
    tasks_done: 0,
    tasks_done_is_manual: false,
    hours_per_task: PROJECT_DEFAULTS[project].hoursPerTask,
    usd_per_task: PROJECT_DEFAULTS[project].usdPerTask,
    carry_in_hours: 0,
    tracker_start_minutes: null,
    tracker_end_minutes: null,
  };
}

// ─── The maths ───────────────────────────────────────────────────────────────

export interface ProjectTotals {
  project: ProjectKey;
  tasksDone: number;
  /** What this week's tasks are worth, in hours. */
  earnedHours: number;
  /** Hours owed from before, entered by hand. */
  carryInHours: number;
  /** earned + carried — what still has to appear in the tracker. */
  requiredHours: number;
  /** null when either meter reading is missing. */
  loggedHours: number | null;
  /** Positive: still owed. Negative: logged more than was owed. */
  remainingHours: number | null;
  /** Set when the meter went backwards — a reset, or two readings swapped. */
  meterWentBackwards: boolean;
  taskPayUsd: number;
  bonusUsd: number;
  bonusTasks: number;
  totalUsd: number;
}

export function projectTotals(
  row: WorkWeekProject,
  bonuses: WorkWeekBonus[]
): ProjectTotals {
  const mine = bonuses.filter((bonus) => bonus.project === row.project);
  const bonusUsd = round2(mine.reduce((sum, bonus) => sum + toNumber(bonus.amount_usd), 0));

  const tasksDone = Math.max(0, toNumber(row.tasks_done));
  const earnedHours = round2(tasksDone * toNumber(row.hours_per_task));
  const carryInHours = round2(toNumber(row.carry_in_hours));
  const requiredHours = round2(earnedHours + carryInHours);

  const start = row.tracker_start_minutes;
  const end = row.tracker_end_minutes;
  const bothRead = start !== null && end !== null;
  // A meter that went backwards means it was reset, or the two readings were
  // entered the wrong way round. Either way the difference is not hours worked,
  // so it is reported as unknown rather than as a negative or an absolute value.
  const meterWentBackwards = bothRead && (end as number) < (start as number);
  const loggedHours = bothRead && !meterWentBackwards
    ? round2(minutesToHours((end as number) - (start as number)))
    : null;

  const taskPayUsd = round2(tasksDone * toNumber(row.usd_per_task));

  return {
    project: row.project,
    tasksDone,
    earnedHours,
    carryInHours,
    requiredHours,
    loggedHours,
    remainingHours: loggedHours === null ? null : round2(requiredHours - loggedHours),
    meterWentBackwards,
    taskPayUsd,
    bonusUsd,
    bonusTasks: mine.length,
    totalUsd: round2(taskPayUsd + bonusUsd),
  };
}

export interface WeekTotals {
  byProject: Record<ProjectKey, ProjectTotals>;
  earnedHours: number;
  carryInHours: number;
  requiredHours: number;
  /** Sum of the projects that have both readings; null only if none do. */
  loggedHours: number | null;
  /** What rolls into next week. Null while any project is unmeasured. */
  remainingHours: number | null;
  /** True when a project is missing a reading, so the totals are partial. */
  partial: boolean;
  taskPayUsd: number;
  bonusUsd: number;
  bonusTasks: number;
  totalUsd: number;
}

export function weekTotals(
  projects: WorkWeekProject[],
  bonuses: WorkWeekBonus[]
): WeekTotals {
  const byProject = {} as Record<ProjectKey, ProjectTotals>;
  for (const project of PROJECTS) {
    const row = projects.find((candidate) => candidate.project === project);
    byProject[project] = projectTotals(row ?? emptyProject('', project), bonuses);
  }

  const all = PROJECTS.map((project) => byProject[project]);
  const measured = all.filter((totals) => totals.loggedHours !== null);
  const partial = measured.length < all.length;

  return {
    byProject,
    earnedHours: round2(sum(all.map((totals) => totals.earnedHours))),
    carryInHours: round2(sum(all.map((totals) => totals.carryInHours))),
    requiredHours: round2(sum(all.map((totals) => totals.requiredHours))),
    loggedHours: measured.length ? round2(sum(measured.map((t) => t.loggedHours as number))) : null,
    remainingHours: partial
      ? null
      : round2(sum(all.map((totals) => totals.remainingHours as number))),
    partial,
    taskPayUsd: round2(sum(all.map((totals) => totals.taskPayUsd))),
    bonusUsd: round2(sum(all.map((totals) => totals.bonusUsd))),
    bonusTasks: all.reduce((count, totals) => count + totals.bonusTasks, 0),
    totalUsd: round2(sum(all.map((totals) => totals.totalUsd))),
  };
}

export interface MemberTotals {
  userId: string;
  name: string;
  tasksByProject: Record<ProjectKey, number>;
  tasksDone: number;
  bonusTasks: number;
  bonusUsd: number;
  taskPayUsd: number;
  totalUsd: number;
}

/**
 * What each person did and is owed.
 *
 * Paid at the project's rate, so somebody splitting a week between the two
 * projects is paid correctly for each — the reason the per-person rows are
 * stored per project rather than as one number.
 */
export function memberTotals(
  members: User[],
  rows: WorkWeekMember[],
  projects: WorkWeekProject[],
  bonuses: WorkWeekBonus[]
): MemberTotals[] {
  const rateFor = (project: ProjectKey) =>
    toNumber(projects.find((row) => row.project === project)?.usd_per_task ?? 0);

  return members.map((member) => {
    const tasksByProject = {} as Record<ProjectKey, number>;
    let taskPayUsd = 0;
    for (const project of PROJECTS) {
      const tasks = Math.max(
        0,
        toNumber(
          rows.find((row) => row.user_id === member.id && row.project === project)?.tasks_done ?? 0
        )
      );
      tasksByProject[project] = tasks;
      taskPayUsd += tasks * rateFor(project);
    }

    const mine = bonuses.filter((bonus) => bonus.user_id === member.id);
    const bonusUsd = round2(mine.reduce((total, bonus) => total + toNumber(bonus.amount_usd), 0));
    const rounded = round2(taskPayUsd);

    return {
      userId: member.id,
      name: member.name,
      tasksByProject,
      tasksDone: PROJECTS.reduce((count, project) => count + tasksByProject[project], 0),
      bonusTasks: mine.length,
      bonusUsd,
      taskPayUsd: rounded,
      totalUsd: round2(rounded + bonusUsd),
    };
  });
}

/**
 * How many AGNUS tasks were approved inside the week — the number offered to
 * an admin as a starting point.
 *
 * Keyed on `admin_verdict_date`, the moment the approval was recorded, which
 * is the only field that says when the work was *accepted*. Tasks approved
 * without that stamp fall back to `updated`, matching the convention on the
 * Payments page.
 */
export function suggestedAgnusTasks(tasks: Task[], friday: Date): number {
  return tasks.filter((task) => {
    if (task.status !== 'approved') return false;
    const stamp = task.admin_verdict_date || task.updated;
    if (!stamp) return false;
    const when = new Date(stamp);
    if (Number.isNaN(when.getTime())) return false;
    return isInWeek(when, friday);
  }).length;
}

// ─── Small helpers ───────────────────────────────────────────────────────────

/** Postgres numerics arrive as strings often enough to be worth the guard. */
function toNumber(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

/** Money and hours both round to two places; floats otherwise leak 0.1+0.2. */
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
