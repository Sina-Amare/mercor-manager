import { supabase } from './supabase';
import { wrapSupabaseError } from './errors';
import { importUsers } from './users';
import { useAppStore } from '../store';
import { TASK_STATUSES, type Task, type User, type TaskStatus, type AppSettings } from '../types';

// ─── Cloud Access ─────────────────────────────────────────────────────────────
//
// Supabase is the only source of truth. A failed write throws so the caller can
// surface it; nothing is ever written to a browser-only copy that other members
// could never receive.

const USER_FIELDS = 'id,username,email,name,role,avatar,is_active,created,updated,can_reply_announcements';

function toPublicUser(user: User): User {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    name: user.name,
    role: user.role,
    avatar: user.avatar,
    is_active: user.is_active,
    created: user.created,
    updated: user.updated,
    can_reply_announcements: user.can_reply_announcements ?? false,
  };
}

function deduplicateUsers(users: User[]): User[] {
  return users
    .map(toPublicUser)
    .filter((u, i, arr) => arr.findIndex((x) => x.id === u.id || x.username === u.username) === i);
}

function cloudWriteError(action: string, error: unknown): Error {
  return wrapSupabaseError(action, error);
}

function isUniqueViolation(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && error.code === '23505';
}

function isMissingRecycleBinSchema(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = 'code' in error ? String(error.code) : '';
  const message = 'message' in error ? String(error.message) : '';
  return (
    code === '42703' ||
    code === 'PGRST204' ||
    message.includes('deleted_at') ||
    message.includes('deleted_by')
  );
}

async function stableTaskRecordId(taskId: string): Promise<string> {
  const normalized = taskId.trim().toLocaleLowerCase('en-US');
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(normalized)
    );
    const hash = [...new Uint8Array(digest)]
      .slice(0, 16)
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    return `task_${hash}`;
  }

  let hash = 2166136261;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `task_${(hash >>> 0).toString(16).padStart(8, '0')}_${normalized.length}`;
}

function isUser(value: unknown): value is User {
  if (!value || typeof value !== 'object') return false;
  const user = value as Partial<User>;
  return (
    typeof user.id === 'string' &&
    typeof user.username === 'string' &&
    typeof user.name === 'string' &&
    (user.role === 'admin' || user.role === 'member') &&
    typeof user.is_active === 'boolean'
  );
}

function isTask(value: unknown): value is Task {
  if (!value || typeof value !== 'object') return false;
  const task = value as Partial<Task>;
  return (
    typeof task.id === 'string' &&
    typeof task.task_id === 'string' &&
    typeof task.body === 'string' &&
    typeof task.assigned_to === 'string' &&
    TASK_STATUSES.some((status) => status === task.status)
  );
}

// Rows arrive without the `expand` relation; the store attaches member records
// from its own list. Never set `expand: undefined` here — spreading that key
// over a stored task would wipe an already-resolved member.
function normalizeTask(row: Task): Task {
  const { expand: _expand, ...task } = row;
  return {
    ...task,
    submission_prompt: task.submission_prompt ?? '',
    submission_dsp: task.submission_dsp ?? '',
    submission_final_answer: task.submission_final_answer ?? '',
    submission_notes: task.submission_notes ?? '',
    studio_result: task.studio_result ?? '',
    deleted_at: task.deleted_at ?? null,
    deleted_by: task.deleted_by ?? null,
  };
}

function memberName(userId: string | null | undefined): string | undefined {
  if (!userId) return undefined;
  return useAppStore.getState().members.find((member) => member.id === userId)?.name;
}

// ─── Tasks ───────────────────────────────────────────────────────────────────

export async function fetchTasks(): Promise<Task[]> {
  let { data, error } = await supabase
    .from('tasks')
    .select('*')
    .is('deleted_at', null)
    .order('created', { ascending: false });

  if (error && isMissingRecycleBinSchema(error)) {
    ({ data, error } = await supabase
      .from('tasks')
      .select('*')
      .order('created', { ascending: false }));
  }
  if (error) throw cloudWriteError('Fetching tasks', error);

  return (data || []).map((row) => normalizeTask(row as Task)).filter((task) => !task.deleted_at);
}

export async function fetchDeletedTasks(): Promise<Task[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .not('deleted_at', 'is', null)
    .order('deleted_at', { ascending: false });

  if (error && isMissingRecycleBinSchema(error)) return [];
  if (error) throw cloudWriteError('Fetching recycled tasks', error);

  return (data || []).map((row) => normalizeTask(row as Task));
}

export async function createTask(data: {
  task_id: string;
  body: string;
  assigned_to: string;
}): Promise<Task> {
  const normalizedTaskId = data.task_id.trim();
  const duplicate = await checkDuplicateTaskId(normalizedTaskId);
  if (duplicate.isDuplicate) {
    throw new Error('This Task ID already exists and cannot be created twice');
  }

  const taskId = await stableTaskRecordId(normalizedTaskId);
  const now = new Date().toISOString();
  const newTask: Task = {
    id: taskId,
    task_id: normalizedTaskId,
    body: data.body,
    assigned_to: data.assigned_to,
    status: 'assigned',
    member_verdict: '',
    member_verdict_date: '',
    admin_verdict: '',
    admin_verdict_date: '',
    admin_notes: '',
    submission_prompt: '',
    submission_dsp: '',
    submission_final_answer: '',
    submission_notes: '',
    studio_result: '',
    payment_status: 'not_applicable',
    payment_amount_usd: 0,
    payment_date: '',
    deleted_at: null,
    deleted_by: null,
    created: now,
    updated: now,
  };

  let { data: createdData, error } = await supabase
    .from('tasks')
    .insert([newTask])
    .select('*')
    .single();

  if (error && isMissingRecycleBinSchema(error)) {
    const legacyTask: Partial<Task> = { ...newTask };
    delete legacyTask.deleted_at;
    delete legacyTask.deleted_by;
    ({ data: createdData, error } = await supabase
      .from('tasks')
      .insert([legacyTask])
      .select('*')
      .single());
  }

  if (error) {
    if (isUniqueViolation(error)) {
      throw new Error('This Task ID already exists and cannot be created twice');
    }
    throw cloudWriteError('Creating task', error);
  }
  if (!createdData) throw new Error('Creating task returned no record');

  return normalizeTask(createdData as Task);
}

export interface TaskUpdateGuard {
  expectedStatus: TaskStatus;
  expectedAssignee?: string;
  expectedUpdated?: string;
}

export class TaskConflictError extends Error {
  latestTask: Task | null | undefined;

  constructor(latestTask: Task | null | undefined) {
    super('Task changed on another device');
    this.name = 'TaskConflictError';
    this.latestTask = latestTask;
  }
}

export async function updateTask(
  id: string,
  data: Partial<Task>,
  guard?: TaskUpdateGuard
): Promise<Task> {
  const updatedFields = { ...data, updated: new Date().toISOString() };
  delete updatedFields.expand;

  let updateQuery = supabase.from('tasks').update(updatedFields).eq('id', id);

  if (guard) {
    updateQuery = updateQuery.eq('status', guard.expectedStatus);
    if (guard.expectedAssignee) {
      updateQuery = updateQuery.eq('assigned_to', guard.expectedAssignee);
    }
    if (guard.expectedUpdated) {
      updateQuery = updateQuery.eq('updated', guard.expectedUpdated);
    }
  }

  const { data: updatedData, error } = await updateQuery.select('*').maybeSingle();

  if (error) throw cloudWriteError('Updating task', error);

  if (!updatedData && guard) {
    // The guard did not match. Report the row as it now stands so the caller can
    // reconcile instead of overwriting somebody else's change.
    const { data: latestData, error: latestError } = await supabase
      .from('tasks')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    const latestTask = latestError
      ? undefined
      : latestData
        ? normalizeTask(latestData as Task)
        : null;
    throw new TaskConflictError(latestTask);
  }
  if (!updatedData) throw new Error('Task not found');

  return normalizeTask(updatedData as Task);
}

export async function updateTasks(ids: string[], data: Partial<Task>): Promise<Task[]> {
  if (ids.length === 0) return [];
  const updatedFields = { ...data, updated: new Date().toISOString() };
  delete updatedFields.expand;

  const { data: updatedData, error } = await supabase
    .from('tasks')
    .update(updatedFields)
    .in('id', ids)
    .select('*');

  if (error) throw cloudWriteError('Updating tasks', error);
  return (updatedData || []).map((row) => normalizeTask(row as Task));
}

export async function moveTaskToTrash(id: string, deletedBy: string): Promise<Task> {
  const deletedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from('tasks')
    .update({ deleted_at: deletedAt, deleted_by: deletedBy, updated: deletedAt })
    .eq('id', id)
    .is('deleted_at', null)
    .select('*')
    .maybeSingle();

  if (error) {
    if (isMissingRecycleBinSchema(error)) {
      throw new Error('Recycle Bin database migration has not been applied yet');
    }
    throw cloudWriteError('Moving task to Recycle Bin', error);
  }
  if (!data) throw new Error('Task was already recycled or no longer exists');

  return normalizeTask(data as Task);
}

export async function moveTasksToTrash(ids: string[], deletedBy: string): Promise<Task[]> {
  if (ids.length === 0) return [];
  const deletedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from('tasks')
    .update({ deleted_at: deletedAt, deleted_by: deletedBy, updated: deletedAt })
    .in('id', ids)
    .is('deleted_at', null)
    .select('*');

  if (error) {
    if (isMissingRecycleBinSchema(error)) {
      throw new Error('Recycle Bin database migration has not been applied yet');
    }
    throw cloudWriteError('Moving tasks to Recycle Bin', error);
  }

  return (data || []).map((row) => normalizeTask(row as Task));
}

export async function restoreTask(id: string): Promise<Task> {
  const restoredAt = new Date().toISOString();
  const { data, error } = await supabase
    .from('tasks')
    .update({ deleted_at: null, deleted_by: null, updated: restoredAt })
    .eq('id', id)
    .not('deleted_at', 'is', null)
    .select('*')
    .maybeSingle();

  if (error) throw cloudWriteError('Restoring task', error);
  if (!data) throw new Error('Task was already restored or no longer exists');

  return normalizeTask(data as Task);
}

export async function checkDuplicateTaskId(taskId: string): Promise<{
  isDuplicate: boolean;
  isRecycled?: boolean;
  existingTask?: Task;
  assignedToName?: string;
}> {
  // ilike treats % and _ as wildcards, while the database's uniqueness is a
  // plain btrim(lower(...)) comparison — escape them so an id that merely
  // contains one is not reported as a duplicate of a different task.
  const escaped = taskId.trim().replace(/[\\%_]/g, (ch) => `\\${ch}`);
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .ilike('task_id', escaped)
    .limit(1);

  if (error) throw cloudWriteError('Checking duplicate task ID', error);
  if (!data || data.length === 0) return { isDuplicate: false };

  const existing = normalizeTask(data[0] as Task);
  return {
    isDuplicate: true,
    isRecycled: Boolean(existing.deleted_at),
    existingTask: existing,
    assignedToName: memberName(existing.assigned_to) || 'Unknown Member',
  };
}

// ─── Users / Members ─────────────────────────────────────────────────────────

export async function fetchAllUsers(): Promise<User[]> {
  const { data, error } = await supabase.from('users').select(USER_FIELDS).order('name');
  if (error) throw cloudWriteError('Fetching users', error);
  return deduplicateUsers((data || []) as User[]);
}

// Creating, updating, deactivating and removing members lives in ./users.ts —
// those writes run through the admin-users Edge Function under the service role.

// ─── Settings ────────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS: AppSettings = {
  id: 'settings_1',
  usd_to_irr_rate: 580000,
  updated: new Date().toISOString(),
};

export async function fetchSettings(): Promise<AppSettings> {
  const { data, error } = await supabase.from('settings').select('*').limit(1);
  if (error) throw cloudWriteError('Fetching settings', error);
  if (data && data.length > 0) return data[0] as AppSettings;
  return DEFAULT_SETTINGS;
}

export async function updateSettings(
  id: string,
  data: Partial<AppSettings>
): Promise<AppSettings> {
  const { data: updatedData, error } = await supabase
    .from('settings')
    .upsert([{ id: id || DEFAULT_SETTINGS.id, ...data, updated: new Date().toISOString() }])
    .select('*')
    .single();

  if (error) throw cloudWriteError('Updating settings', error);
  if (!updatedData) throw new Error('Updating settings returned no record');
  return updatedData as AppSettings;
}

// ─── Backup ──────────────────────────────────────────────────────────────────

export async function exportBackup(): Promise<string> {
  const [tasksResult, usersResult, settingsResult] = await Promise.all([
    supabase.from('tasks').select('*').order('created', { ascending: false }),
    supabase.from('users').select(USER_FIELDS).order('name'),
    supabase.from('settings').select('*').limit(1),
  ]);

  const failure = tasksResult.error || usersResult.error || settingsResult.error;
  if (failure) throw cloudWriteError('Exporting backup', failure);

  return JSON.stringify(
    {
      version: 4,
      timestamp: new Date().toISOString(),
      tasks: (tasksResult.data || []).map((row) => normalizeTask(row as Task)),
      users: deduplicateUsers((usersResult.data || []) as User[]),
      settings: (settingsResult.data?.[0] as AppSettings) || DEFAULT_SETTINGS,
    },
    null,
    2
  );
}

export async function importBackup(jsonStr: string): Promise<{
  tasks: Task[];
  trashedTasks: Task[];
  users: User[];
  settings: AppSettings;
}> {
  const parsed = JSON.parse(jsonStr);
  if (!Array.isArray(parsed.tasks) || !Array.isArray(parsed.users)) {
    throw new Error('Backup must contain task and user arrays');
  }
  if (!parsed.settings || typeof parsed.settings !== 'object') {
    throw new Error('Backup must contain settings');
  }
  if (!parsed.tasks.every(isTask) || !parsed.users.every(isUser)) {
    throw new Error('Backup contains invalid task or user records');
  }
  if (typeof parsed.settings.usd_to_irr_rate !== 'number') {
    throw new Error('Backup contains invalid settings');
  }

  const importedTasks = (parsed.tasks as Task[]).map(normalizeTask);
  const importedUsers = deduplicateUsers(parsed.users as User[]);
  const importedSettings = parsed.settings as AppSettings;

  // Users go through the admin-users Edge Function: the client holds only a
  // SELECT grant on public.users since the RLS cutover, so an upsert from here
  // is refused no matter who is importing. Settings and tasks the client may
  // still write directly.
  const [usersError, settingsResult] = await Promise.all([
    importUsers(importedUsers).then(
      () => undefined,
      (error: unknown) => cloudWriteError('Importing users', error)
    ),
    supabase.from('settings').upsert(importedSettings),
  ]);

  let tasksResult = await supabase.from('tasks').upsert(importedTasks);
  if (tasksResult.error && isMissingRecycleBinSchema(tasksResult.error)) {
    const legacyTaskRows = importedTasks.map((task) => {
      const legacyTask: Partial<Task> = { ...task };
      delete legacyTask.deleted_at;
      delete legacyTask.deleted_by;
      return legacyTask;
    });
    tasksResult = await supabase.from('tasks').upsert(legacyTaskRows);
  }

  const syncError = usersError || tasksResult.error || settingsResult.error;
  if (syncError) throw cloudWriteError('Importing backup', syncError);

  return {
    tasks: importedTasks.filter((task) => !task.deleted_at),
    trashedTasks: importedTasks.filter((task) => Boolean(task.deleted_at)),
    users: importedUsers,
    settings: importedSettings,
  };
}

// ─── Realtime Subscriptions ──────────────────────────────────────────────────

export interface TaskRealtimeEvent {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  newTask: Task | null;
  oldTask: Partial<Task> | null;
}

export interface UserRealtimeEvent {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  newUser: User | null;
  oldUser: Partial<User> | null;
}

export interface SettingsRealtimeEvent {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  newSettings: AppSettings | null;
  oldSettings: Partial<AppSettings> | null;
}

export function subscribeToTasks(
  callback: (event: TaskRealtimeEvent) => void,
  onStatus?: (status: string) => void
) {
  try {
    const channel = supabase
      .channel(`public:tasks:${globalThis.crypto?.randomUUID?.() || Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, (payload) => {
        callback({
          eventType: payload.eventType as TaskRealtimeEvent['eventType'],
          newTask:
            payload.eventType === 'DELETE' ? null : normalizeTask(payload.new as Task),
          oldTask: payload.old as Partial<Task>,
        });
      })
      .subscribe((status) => onStatus?.(status));

    return () => {
      void supabase.removeChannel(channel);
    };
  } catch {
    return () => {};
  }
}

export function subscribeToUsers(
  callback: (event: UserRealtimeEvent) => void,
  onStatus?: (status: string) => void
) {
  try {
    const channel = supabase
      .channel(`public:users:${globalThis.crypto?.randomUUID?.() || Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, (payload) => {
        const newUser =
          payload.eventType === 'DELETE' || !isUser(payload.new)
            ? null
            : toPublicUser(payload.new);

        callback({
          eventType: payload.eventType as UserRealtimeEvent['eventType'],
          newUser,
          oldUser: payload.old as Partial<User>,
        });
      })
      .subscribe((status) => onStatus?.(status));

    return () => {
      void supabase.removeChannel(channel);
    };
  } catch {
    return () => {};
  }
}

export function subscribeToSettings(
  callback: (event: SettingsRealtimeEvent) => void,
  onStatus?: (status: string) => void
) {
  try {
    const channel = supabase
      .channel(`public:settings:${globalThis.crypto?.randomUUID?.() || Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settings' }, (payload) => {
        const newSettings =
          payload.eventType === 'DELETE' ? null : (payload.new as AppSettings);

        callback({
          eventType: payload.eventType as SettingsRealtimeEvent['eventType'],
          newSettings,
          oldSettings: payload.old as Partial<AppSettings>,
        });
      })
      .subscribe((status) => onStatus?.(status));

    return () => {
      void supabase.removeChannel(channel);
    };
  } catch {
    return () => {};
  }
}
