import { supabase } from './supabase';
import type {
  ProjectKey,
  WorkWeek,
  WorkWeekBonus,
  WorkWeekMember,
  WorkWeekProject,
} from '../weeklyLedger';
import { emptyProject, weekIdFor } from '../weeklyLedger';

const WEEK_FIELDS = 'id,starts_on,notes,created,updated';
const PROJECT_FIELDS =
  'week_id,project,tasks_done,tasks_done_is_manual,hours_per_task,usd_per_task,carry_in_hours,tracker_start_minutes,tracker_end_minutes';
const MEMBER_FIELDS = 'week_id,user_id,project,tasks_done';
const BONUS_FIELDS = 'id,week_id,user_id,project,amount_usd,note,created';

function ledgerError(action: string, error: unknown) {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  if (code === 'PGRST205' || code === '42P01') {
    return new Error('The weekly ledger has not been configured in Supabase yet');
  }
  const message =
    error instanceof Error
      ? error.message
      : error && typeof error === 'object' && 'message' in error
        ? String(error.message)
        : 'Unknown cloud error';
  return new Error(`${action} failed in Supabase: ${message}`);
}

/**
 * Postgres `numeric` comes back as a string over PostgREST. Coercing here
 * rather than at every call site keeps the arithmetic module free of the
 * transport's quirks.
 */
function numeric<T>(row: T, keys: (keyof T)[]): T {
  const copy = { ...row };
  for (const key of keys) {
    const value = copy[key];
    if (value !== null && value !== undefined) {
      copy[key] = Number(value) as unknown as T[keyof T];
    }
  }
  return copy;
}

export interface LedgerSnapshot {
  weeks: WorkWeek[];
  projects: WorkWeekProject[];
  members: WorkWeekMember[];
  bonuses: WorkWeekBonus[];
}

/**
 * The whole ledger in one round trip.
 *
 * It is four small admin-only tables — a handful of rows per week for a team of
 * three — so paging it by month would add a loading state and a stale-cache
 * problem to save nothing worth measuring.
 */
export async function fetchLedger(): Promise<LedgerSnapshot> {
  const [weeks, projects, members, bonuses] = await Promise.all([
    supabase.from('work_weeks').select(WEEK_FIELDS).order('starts_on', { ascending: false }),
    supabase.from('work_week_projects').select(PROJECT_FIELDS),
    supabase.from('work_week_members').select(MEMBER_FIELDS),
    supabase.from('work_week_bonuses').select(BONUS_FIELDS).order('created', { ascending: true }),
  ]);

  for (const [action, result] of [
    ['Loading weeks', weeks],
    ['Loading week projects', projects],
    ['Loading week members', members],
    ['Loading bonuses', bonuses],
  ] as const) {
    if (result.error) throw ledgerError(action, result.error);
  }

  return {
    weeks: (weeks.data || []) as WorkWeek[],
    projects: ((projects.data || []) as WorkWeekProject[]).map((row) =>
      numeric(row, ['tasks_done', 'hours_per_task', 'usd_per_task', 'carry_in_hours'])
    ),
    members: ((members.data || []) as WorkWeekMember[]).map((row) => numeric(row, ['tasks_done'])),
    bonuses: ((bonuses.data || []) as WorkWeekBonus[]).map((row) => numeric(row, ['amount_usd'])),
  };
}

/**
 * Creates the week and both project rows if they are not there yet.
 *
 * Idempotent, so opening a week is safe to call on every expand — the admin
 * never has to "create" a week before typing into it.
 */
export async function ensureWeek(startsOn: string, seedFrom?: WorkWeekProject[]): Promise<string> {
  const id = weekIdFor(startsOn);

  const { error: weekError } = await supabase
    .from('work_weeks')
    .upsert({ id, starts_on: startsOn }, { onConflict: 'id', ignoreDuplicates: true });
  if (weekError) throw ledgerError('Opening the week', weekError);

  // Rates carry forward from the week they were last set in, so a change made
  // once keeps applying without being retyped — and without rewriting history.
  const rows = (['agnus', 'chromium'] as ProjectKey[]).map((project) => {
    const previous = seedFrom?.find((row) => row.project === project);
    const seed = emptyProject(id, project);
    return {
      ...seed,
      hours_per_task: previous?.hours_per_task ?? seed.hours_per_task,
      usd_per_task: previous?.usd_per_task ?? seed.usd_per_task,
    };
  });

  const { error: projectError } = await supabase
    .from('work_week_projects')
    .upsert(rows, { onConflict: 'week_id,project', ignoreDuplicates: true });
  if (projectError) throw ledgerError('Opening the week', projectError);

  return id;
}

export async function saveWeekProject(row: WorkWeekProject): Promise<void> {
  const { error } = await supabase
    .from('work_week_projects')
    .upsert(row, { onConflict: 'week_id,project' });
  if (error) throw ledgerError('Saving the project figures', error);
}

export async function saveWeekMembers(rows: WorkWeekMember[]): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await supabase
    .from('work_week_members')
    .upsert(rows, { onConflict: 'week_id,user_id,project' });
  if (error) throw ledgerError('Saving the per-person figures', error);
}

export async function saveWeekNotes(weekId: string, notes: string): Promise<void> {
  const { error } = await supabase.from('work_weeks').update({ notes }).eq('id', weekId);
  if (error) throw ledgerError('Saving the note', error);
}

export async function addBonus(input: {
  weekId: string;
  userId: string | null;
  project: ProjectKey;
  amountUsd: number;
  note: string;
}): Promise<WorkWeekBonus> {
  const { data, error } = await supabase
    .from('work_week_bonuses')
    .insert({
      id: `bonus_${globalThis.crypto?.randomUUID?.().replace(/-/g, '') || Date.now()}`,
      week_id: input.weekId,
      user_id: input.userId,
      project: input.project,
      amount_usd: input.amountUsd,
      note: input.note.trim(),
    })
    .select(BONUS_FIELDS)
    .single();

  if (error) throw ledgerError('Adding the bonus', error);
  return numeric(data as WorkWeekBonus, ['amount_usd']);
}

export async function removeBonus(id: string): Promise<void> {
  const { error } = await supabase.from('work_week_bonuses').delete().eq('id', id);
  if (error) throw ledgerError('Removing the bonus', error);
}

/** One channel for all four tables; any change refetches the snapshot. */
export function subscribeToLedger(onChange: () => void, onStatus?: (status: string) => void) {
  try {
    const channel = supabase.channel(
      `public:weekly-ledger:${globalThis.crypto?.randomUUID?.() || Date.now()}`
    );
    for (const table of [
      'work_weeks',
      'work_week_projects',
      'work_week_members',
      'work_week_bonuses',
    ]) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => onChange());
    }
    channel.subscribe((status) => onStatus?.(status));
    return () => {
      void supabase.removeChannel(channel);
    };
  } catch {
    return () => {};
  }
}
