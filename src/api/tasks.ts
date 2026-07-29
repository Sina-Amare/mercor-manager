import { supabase } from './supabase';
import { TASK_STATUSES, type Task, type User, type TaskStatus, type AppSettings } from '../types';
import { MOCK_TASKS, MOCK_USERS, MOCK_SETTINGS } from './mockData';

// ─── Local Cache & Deduplication ──────────────────────────────────────────────

const LOCAL_FALLBACK_ENABLED = import.meta.env.VITE_ENABLE_LOCAL_FALLBACK === 'true';
const USER_FIELDS = 'id,username,email,name,role,avatar,is_active,created,updated';

let localTasks: Task[] = [...MOCK_TASKS];
let localUsers: User[] = [...MOCK_USERS];
let localSettings: AppSettings = { ...MOCK_SETTINGS };
let localPasswords: Record<string, string> = {};

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
  };
}

function deduplicateUsers(users: User[]): User[] {
  return users
    .map(toPublicUser)
    .filter((u, i, arr) => arr.findIndex((x) => x.id === u.id || x.username === u.username) === i);
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) {
    return String(error.message);
  }
  return 'Unknown cloud error';
}

function cloudWriteError(action: string, error: unknown): Error {
  return new Error(`${action} failed in Supabase: ${getErrorMessage(error)}`);
}

function isUniqueViolation(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && error.code === '23505';
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

function normalizeTask(task: Task): Task {
  return {
    ...task,
    submission_prompt: task.submission_prompt ?? '',
    submission_dsp: task.submission_dsp ?? '',
    submission_final_answer: task.submission_final_answer ?? '',
    submission_notes: task.submission_notes ?? '',
    studio_result: task.studio_result ?? '',
  };
}

// Load from localStorage if available
try {
  const savedTasks = localStorage.getItem('agnus_local_tasks');
  if (savedTasks) {
    localTasks = (JSON.parse(savedTasks) as Task[]).map(({ expand: _expand, ...task }) =>
      normalizeTask(task as Task)
    );
  }
  const savedUsers = localStorage.getItem('agnus_local_users');
  if (savedUsers) localUsers = deduplicateUsers(JSON.parse(savedUsers));
  const savedSettings = localStorage.getItem('agnus_local_settings');
  if (savedSettings) localSettings = JSON.parse(savedSettings);
  if (LOCAL_FALLBACK_ENABLED) {
    const savedPasswords = localStorage.getItem('agnus_local_passwords');
    if (savedPasswords) localPasswords = JSON.parse(savedPasswords);
  } else {
    localStorage.removeItem('agnus_local_passwords');
  }
} catch {
  // Ignore localStorage errors
}

function saveLocalState() {
  try {
    localUsers = deduplicateUsers(localUsers);
    const cachedTasks = localTasks.map(({ expand: _expand, ...task }) => task);
    localStorage.setItem('agnus_local_tasks', JSON.stringify(cachedTasks));
    localStorage.setItem('agnus_local_users', JSON.stringify(localUsers));
    localStorage.setItem('agnus_local_settings', JSON.stringify(localSettings));
    if (LOCAL_FALLBACK_ENABLED) {
      localStorage.setItem('agnus_local_passwords', JSON.stringify(localPasswords));
    } else {
      localStorage.removeItem('agnus_local_passwords');
    }
  } catch {
    // Ignore localStorage errors
  }
}

export function validateLocalLogin(username: string, password: string): User | null {
  if (!LOCAL_FALLBACK_ENABLED) return null;

  const cleanUsername = username.trim().toLowerCase();
  const cleanPassword = password.trim();

  const user =
    localUsers.find((u) => u.username.trim().toLowerCase() === cleanUsername) ||
    MOCK_USERS.find((u) => u.username.trim().toLowerCase() === cleanUsername);

  if (!user || !user.is_active) return null;
  const savedPassword = localPasswords[cleanUsername];
  return savedPassword && savedPassword === cleanPassword ? user : null;
}

// Helper to expand task assigned_to user
function expandTask(task: Task, userList: User[]): Task {
  const assigned = userList.find((u) => u.id === task.assigned_to);
  return {
    ...normalizeTask(task),
    expand: { assigned_to: assigned },
  };
}

// ─── Tasks ───────────────────────────────────────────────────────────────────

export async function fetchTasks(): Promise<Task[]> {
  try {
    const { data: usersData } = await supabase.from('users').select(USER_FIELDS);
    const userList = usersData ? deduplicateUsers(usersData as User[]) : localUsers;

    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .order('created', { ascending: false });

    if (error) throw error;
    if (data) {
      const tasks = data.map((t) => expandTask(t as Task, userList));
      localTasks = tasks;
      saveLocalState();
      return tasks;
    }
  } catch (error) {
    if (!LOCAL_FALLBACK_ENABLED) throw cloudWriteError('Fetching tasks', error);
  }
  return localTasks;
}

export async function fetchTasksByMember(memberId: string): Promise<Task[]> {
  try {
    const { data: usersData } = await supabase.from('users').select(USER_FIELDS);
    const userList = usersData ? deduplicateUsers(usersData as User[]) : localUsers;

    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .eq('assigned_to', memberId)
      .order('created', { ascending: false });

    if (error) throw error;
    if (data) {
      return data.map((t) => expandTask(t as Task, userList));
    }
  } catch (error) {
    if (!LOCAL_FALLBACK_ENABLED) throw cloudWriteError('Fetching member tasks', error);
  }
  return localTasks.filter((t) => t.assigned_to === memberId);
}

export async function fetchTasksByStatus(status: TaskStatus): Promise<Task[]> {
  try {
    const { data: usersData } = await supabase.from('users').select(USER_FIELDS);
    const userList = usersData ? deduplicateUsers(usersData as User[]) : localUsers;

    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .eq('status', status)
      .order('created', { ascending: false });

    if (error) throw error;
    if (data) {
      return data.map((t) => expandTask(t as Task, userList));
    }
  } catch (error) {
    if (!LOCAL_FALLBACK_ENABLED) throw cloudWriteError('Fetching status tasks', error);
  }
  return localTasks.filter((t) => t.status === status);
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
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
  };

  try {
    const { data: createdData, error } = await supabase
      .from('tasks')
      .insert([newTask])
      .select('*')
      .single();
    if (error) throw error;
    if (createdData) {
      const expanded = expandTask(createdData as Task, localUsers);
      localTasks.unshift(expanded);
      saveLocalState();
      return expanded;
    }
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new Error('This Task ID already exists and cannot be created twice');
    }
    if (!LOCAL_FALLBACK_ENABLED) throw cloudWriteError('Creating task', error);
  }

  const assignedUser = localUsers.find((u) => u.id === data.assigned_to);
  newTask.expand = { assigned_to: assignedUser };
  localTasks.unshift(newTask);
  saveLocalState();
  return newTask;
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

  try {
    let updateQuery = supabase
      .from('tasks')
      .update(updatedFields)
      .eq('id', id);

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

    if (error) throw error;
    if (!updatedData && guard) {
      const { data: latestData, error: latestError } = await supabase
        .from('tasks')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      const latestTask = latestError
        ? undefined
        : latestData
          ? expandTask(latestData as Task, localUsers)
          : null;
      if (latestTask) {
        const latestIndex = localTasks.findIndex((task) => task.id === id);
        if (latestIndex === -1) localTasks.unshift(latestTask);
        else localTasks[latestIndex] = latestTask;
        saveLocalState();
      }
      throw new TaskConflictError(latestTask);
    }
    if (!updatedData) throw new Error('Task not found');
    if (updatedData) {
      const expanded = expandTask(updatedData as Task, localUsers);
      const idx = localTasks.findIndex((t) => t.id === id);
      if (idx !== -1) localTasks[idx] = expanded;
      saveLocalState();
      return expanded;
    }
  } catch (error) {
    if (error instanceof TaskConflictError) throw error;
    if (!LOCAL_FALLBACK_ENABLED) throw cloudWriteError('Updating task', error);
  }

  const idx = localTasks.findIndex((t) => t.id === id);
  if (idx !== -1) {
    if (
      guard &&
      (
        localTasks[idx].status !== guard.expectedStatus ||
        (guard.expectedAssignee && localTasks[idx].assigned_to !== guard.expectedAssignee) ||
        (guard.expectedUpdated && localTasks[idx].updated !== guard.expectedUpdated)
      )
    ) {
      throw new TaskConflictError(localTasks[idx]);
    }
    const updated: Task = {
      ...localTasks[idx],
      ...data,
      updated: new Date().toISOString(),
    };
    if (data.assigned_to) {
      updated.expand = { assigned_to: localUsers.find((u) => u.id === data.assigned_to) };
    }
    localTasks[idx] = updated;
    saveLocalState();
    return updated;
  }
  throw new Error('Task not found');
}

export async function updateTasks(ids: string[], data: Partial<Task>): Promise<Task[]> {
  if (ids.length === 0) return [];
  const updatedFields = { ...data, updated: new Date().toISOString() };
  delete updatedFields.expand;

  try {
    const { data: updatedData, error } = await supabase
      .from('tasks')
      .update(updatedFields)
      .in('id', ids)
      .select('*');

    if (error) throw error;
    if (updatedData) {
      const updatedTasks = updatedData.map((task) => expandTask(task as Task, localUsers));
      const updatedById = new Map(updatedTasks.map((task) => [task.id, task]));
      localTasks = localTasks.map((task) => updatedById.get(task.id) || task);
      saveLocalState();
      return updatedTasks;
    }
  } catch (error) {
    if (!LOCAL_FALLBACK_ENABLED) throw cloudWriteError('Updating tasks', error);
  }

  const idSet = new Set(ids);
  localTasks = localTasks.map((task) => {
    if (!idSet.has(task.id)) return task;
    const updated = { ...task, ...data, updated: new Date().toISOString() };
    if (data.assigned_to) {
      updated.expand = {
        assigned_to: localUsers.find((user) => user.id === data.assigned_to),
      };
    }
    return updated;
  });
  saveLocalState();
  return localTasks.filter((task) => idSet.has(task.id));
}

export async function deleteTask(id: string): Promise<void> {
  try {
    const { error } = await supabase.from('tasks').delete().eq('id', id);
    if (error) throw error;
  } catch (error) {
    if (!LOCAL_FALLBACK_ENABLED) throw cloudWriteError('Deleting task', error);
  }
  localTasks = localTasks.filter((t) => t.id !== id);
  saveLocalState();
}

export async function deleteTasks(ids: string[]): Promise<void> {
  try {
    const { error } = await supabase.from('tasks').delete().in('id', ids);
    if (error) throw error;
  } catch (error) {
    if (!LOCAL_FALLBACK_ENABLED) throw cloudWriteError('Deleting tasks', error);
  }
  localTasks = localTasks.filter((t) => !ids.includes(t.id));
  saveLocalState();
}

export async function checkDuplicateTaskId(
  taskId: string
): Promise<{ isDuplicate: boolean; existingTask?: Task; assignedToName?: string }> {
  try {
    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .ilike('task_id', taskId.trim())
      .limit(1);

    if (error) throw error;
    if (data && data.length > 0) {
      const existing = data[0] as Task;
      const assignedTo = localUsers.find((u) => u.id === existing.assigned_to);
      return {
        isDuplicate: true,
        existingTask: existing,
        assignedToName: assignedTo?.name || 'Unknown Member',
      };
    }
  } catch (error) {
    if (!LOCAL_FALLBACK_ENABLED) throw cloudWriteError('Checking duplicate task ID', error);
  }

  const existing = localTasks.find(
    (t) => t.task_id.toLowerCase() === taskId.trim().toLowerCase()
  );
  if (!existing) return { isDuplicate: false };
  const assignedTo = localUsers.find((u) => u.id === existing.assigned_to);
  return {
    isDuplicate: true,
    existingTask: existing,
    assignedToName: assignedTo?.name || existing.expand?.assigned_to?.name || 'Unknown',
  };
}

// ─── Users / Members ─────────────────────────────────────────────────────────

export async function fetchMembers(): Promise<User[]> {
  try {
    const { data, error } = await supabase
      .from('users')
      .select(USER_FIELDS)
      .eq('role', 'member')
      .order('name');

    if (error) throw error;
    if (data) {
      localUsers = deduplicateUsers(data as User[]);
      saveLocalState();
      return localUsers;
    }
  } catch (error) {
    if (!LOCAL_FALLBACK_ENABLED) throw cloudWriteError('Fetching members', error);
  }
  return deduplicateUsers(localUsers.filter((u) => u.role === 'member'));
}

export async function fetchAllUsers(): Promise<User[]> {
  try {
    const { data, error } = await supabase
      .from('users')
      .select(USER_FIELDS)
      .order('name');

    if (error) throw error;
    if (data) {
      localUsers = deduplicateUsers(data as User[]);
      saveLocalState();
      return localUsers;
    }
  } catch (error) {
    if (!LOCAL_FALLBACK_ENABLED) throw cloudWriteError('Fetching users', error);
  }
  return deduplicateUsers(localUsers);
}

export async function createUser(data: {
  username: string;
  password: string;
  passwordConfirm: string;
  name: string;
  role: string;
  email?: string;
}): Promise<User> {
  const cleanUsername = data.username.trim().toLowerCase();
  const userId = `user_${globalThis.crypto?.randomUUID?.() || Date.now()}`;

  if (data.password !== data.passwordConfirm) {
    throw new Error('Passwords do not match');
  }
  if (data.password.trim().length < 8) {
    throw new Error('Password must be at least 8 characters');
  }

  const newUser: User = {
    id: userId,
    username: cleanUsername,
    email: data.email || `${cleanUsername}@agnus.local`,
    name: data.name.trim(),
    role: data.role as 'admin' | 'member',
    avatar: '',
    is_active: true,
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
  };

  if (LOCAL_FALLBACK_ENABLED && data.password) {
    localPasswords[cleanUsername] = data.password.trim();
  }

  try {
    const { data: existingUsers, error: lookupError } = await supabase
      .from('users')
      .select('id')
      .eq('username', cleanUsername)
      .limit(1);
    if (lookupError) throw lookupError;
    if (existingUsers && existingUsers.length > 0) {
      throw new Error(`Username "${cleanUsername}" already exists`);
    }

    const { data: createdData, error } = await supabase
      .from('users')
      .insert([{ ...newUser, password: data.password }])
      .select(USER_FIELDS)
      .single();

    if (error) throw error;
    if (createdData) {
      const u = toPublicUser(createdData as User);
      localUsers.push(u);
      saveLocalState();
      return u;
    }
  } catch (error) {
    if (!LOCAL_FALLBACK_ENABLED) throw cloudWriteError('Creating user', error);
  }

  const existingIdx = localUsers.findIndex(
    (u) => u.username.toLowerCase() === cleanUsername
  );
  if (existingIdx !== -1) {
    const updated: User = {
      ...localUsers[existingIdx],
      name: data.name,
      role: data.role as 'admin' | 'member',
      updated: new Date().toISOString(),
    };
    localUsers[existingIdx] = updated;
    saveLocalState();
    return updated;
  }

  localUsers.push(newUser);
  saveLocalState();
  return newUser;
}

export async function updateUser(
  id: string,
  data: Partial<User> & { password?: string; passwordConfirm?: string }
): Promise<User> {
  const { password, passwordConfirm, ...publicUpdates } = data;
  if (password && password !== passwordConfirm) {
    throw new Error('Passwords do not match');
  }
  if (password && password.trim().length < 8) {
    throw new Error('Password must be at least 8 characters');
  }
  if (publicUpdates.username) {
    publicUpdates.username = publicUpdates.username.trim().toLowerCase();
  }
  const cloudUpdates = {
    ...publicUpdates,
    ...(password ? { password: password.trim() } : {}),
    updated: new Date().toISOString(),
  };

  try {
    if (publicUpdates.username) {
      const { data: existingUsers, error: lookupError } = await supabase
        .from('users')
        .select('id')
        .eq('username', publicUpdates.username)
        .neq('id', id)
        .limit(1);
      if (lookupError) throw lookupError;
      if (existingUsers && existingUsers.length > 0) {
        throw new Error(`Username "${publicUpdates.username}" already exists`);
      }
    }

    const { data: updatedData, error } = await supabase
      .from('users')
      .update(cloudUpdates)
      .eq('id', id)
      .select(USER_FIELDS)
      .single();

    if (error) throw error;
    if (updatedData) {
      const u = toPublicUser(updatedData as User);
      const idx = localUsers.findIndex((x) => x.id === id);
      if (idx !== -1) localUsers[idx] = u;
      saveLocalState();
      return u;
    }
  } catch (error) {
    if (!LOCAL_FALLBACK_ENABLED) throw cloudWriteError('Updating user', error);
  }

  const idx = localUsers.findIndex((u) => u.id === id);
  if (idx !== -1) {
    const updated: User = {
      ...localUsers[idx],
      ...publicUpdates,
      updated: new Date().toISOString(),
    };
    if (password) {
      localPasswords[updated.username.trim().toLowerCase()] = password.trim();
    }
    localUsers[idx] = updated;
    saveLocalState();
    return updated;
  }
  throw new Error('User not found');
}

export async function deleteUser(id: string): Promise<void> {
  try {
    const { error } = await supabase.from('users').delete().eq('id', id);
    if (error) throw error;
  } catch (error) {
    if (!LOCAL_FALLBACK_ENABLED) throw cloudWriteError('Deleting user', error);
  }
  localUsers = localUsers.filter((u) => u.id !== id);
  saveLocalState();
}

// ─── Settings ────────────────────────────────────────────────────────────────

export async function fetchSettings(): Promise<AppSettings> {
  try {
    const { data, error } = await supabase.from('settings').select('*').limit(1);
    if (error) throw error;
    if (data && data.length > 0) {
      localSettings = data[0] as AppSettings;
      saveLocalState();
      return localSettings;
    }
  } catch (error) {
    if (!LOCAL_FALLBACK_ENABLED) throw cloudWriteError('Fetching settings', error);
  }
  return localSettings;
}

export async function updateSettings(
  id: string,
  data: Partial<AppSettings>
): Promise<AppSettings> {
  try {
    const { data: updatedData, error } = await supabase
      .from('settings')
      .upsert([{ id: id || 'settings_1', ...data, updated: new Date().toISOString() }])
      .select('*')
      .single();

    if (error) throw error;
    if (updatedData) {
      localSettings = updatedData as AppSettings;
      saveLocalState();
      return localSettings;
    }
  } catch (error) {
    if (!LOCAL_FALLBACK_ENABLED) throw cloudWriteError('Updating settings', error);
  }

  localSettings = { ...localSettings, ...data, updated: new Date().toISOString() };
  saveLocalState();
  return localSettings;
}

export function exportLocalBackup(): string {
  const backupData = {
    version: 2,
    timestamp: new Date().toISOString(),
    tasks: localTasks.map(({ expand: _expand, ...task }) => task),
    users: localUsers.map(toPublicUser),
    settings: localSettings,
  };
  return JSON.stringify(backupData, null, 2);
}

export async function importLocalBackup(
  jsonStr: string
): Promise<{ tasks: Task[]; users: User[]; settings: AppSettings }> {
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

  const importedTasks = parsed.tasks as Task[];
  const importedUsers = deduplicateUsers(parsed.users as User[]);
  const importedSettings = parsed.settings as AppSettings;
  const taskRows = importedTasks.map(({ expand: _expand, ...task }) => task);

  if (!LOCAL_FALLBACK_ENABLED) {
    const [usersResult, tasksResult, settingsResult] = await Promise.all([
      supabase.from('users').upsert(importedUsers),
      supabase.from('tasks').upsert(taskRows),
      supabase.from('settings').upsert(importedSettings),
    ]);
    const syncError = usersResult.error || tasksResult.error || settingsResult.error;
    if (syncError) throw cloudWriteError('Importing backup', syncError);
  }

  localUsers = importedUsers;
  localTasks = importedTasks.map((task) => expandTask(task, importedUsers));
  localSettings = importedSettings;
  saveLocalState();

  return { tasks: localTasks, users: localUsers, settings: localSettings };
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
          newTask: payload.eventType === 'DELETE' ? null : payload.new as Task,
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
          payload.eventType === 'DELETE' ? null : payload.new as AppSettings;

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
