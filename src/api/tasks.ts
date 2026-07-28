import { supabase } from './supabase';
import type { Task, User, TaskStatus, AppSettings } from '../types';
import { MOCK_TASKS, MOCK_USERS, MOCK_SETTINGS } from './mockData';

// ─── Local Cache & Deduplication ──────────────────────────────────────────────

let localTasks: Task[] = [...MOCK_TASKS];
let localUsers: User[] = [...MOCK_USERS];
let localSettings: AppSettings = { ...MOCK_SETTINGS };
let localPasswords: Record<string, string> = {};

function deduplicateUsers(users: User[]): User[] {
  return users.filter((u, i, arr) => arr.findIndex((x) => x.id === u.id || x.username === u.username) === i);
}

// Load from localStorage if available
try {
  const savedTasks = localStorage.getItem('agnus_local_tasks');
  if (savedTasks) localTasks = JSON.parse(savedTasks);
  const savedUsers = localStorage.getItem('agnus_local_users');
  if (savedUsers) localUsers = deduplicateUsers(JSON.parse(savedUsers));
  const savedSettings = localStorage.getItem('agnus_local_settings');
  if (savedSettings) localSettings = JSON.parse(savedSettings);
  const savedPasswords = localStorage.getItem('agnus_local_passwords');
  if (savedPasswords) localPasswords = JSON.parse(savedPasswords);
} catch {
  // Ignore localStorage errors
}

function saveLocalState() {
  try {
    localUsers = deduplicateUsers(localUsers);
    localStorage.setItem('agnus_local_tasks', JSON.stringify(localTasks));
    localStorage.setItem('agnus_local_users', JSON.stringify(localUsers));
    localStorage.setItem('agnus_local_settings', JSON.stringify(localSettings));
    localStorage.setItem('agnus_local_passwords', JSON.stringify(localPasswords));
  } catch {
    // Ignore localStorage errors
  }
}

export function validateLocalLogin(username: string, password: string): User | null {
  const cleanUsername = username.trim().toLowerCase();
  const cleanPassword = password.trim();

  // Find user in localUsers or MOCK_USERS
  const user =
    localUsers.find((u) => u.username.trim().toLowerCase() === cleanUsername) ||
    MOCK_USERS.find((u) => u.username.trim().toLowerCase() === cleanUsername);

  if (!user) return null;

  const savedPassword = localPasswords[cleanUsername];
  if (savedPassword) {
    return savedPassword === cleanPassword ? user : null;
  }

  // If no password set yet, save this password on first login
  if (cleanPassword) {
    localPasswords[cleanUsername] = cleanPassword;
    saveLocalState();
  }
  return user;
}

// Helper to expand task assigned_to user
function expandTask(task: Task, userList: User[]): Task {
  const assigned = userList.find((u) => u.id === task.assigned_to);
  return {
    ...task,
    expand: { assigned_to: assigned },
  };
}

// ─── Tasks ───────────────────────────────────────────────────────────────────

export async function fetchTasks(): Promise<Task[]> {
  try {
    const { data: usersData } = await supabase.from('users').select('*');
    const userList = usersData && usersData.length > 0 ? (usersData as User[]) : localUsers;

    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .order('created', { ascending: false });

    if (!error && data) {
      const tasks = data.map((t) => expandTask(t as Task, userList));
      localTasks = tasks;
      saveLocalState();
      return tasks;
    }
  } catch {
    // Fallback
  }
  return localTasks;
}

export async function fetchTasksByMember(memberId: string): Promise<Task[]> {
  try {
    const { data: usersData } = await supabase.from('users').select('*');
    const userList = usersData && usersData.length > 0 ? (usersData as User[]) : localUsers;

    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .eq('assigned_to', memberId)
      .order('created', { ascending: false });

    if (!error && data) {
      return data.map((t) => expandTask(t as Task, userList));
    }
  } catch {
    // Fallback
  }
  return localTasks.filter((t) => t.assigned_to === memberId);
}

export async function fetchTasksByStatus(status: TaskStatus): Promise<Task[]> {
  try {
    const { data: usersData } = await supabase.from('users').select('*');
    const userList = usersData && usersData.length > 0 ? (usersData as User[]) : localUsers;

    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .eq('status', status)
      .order('created', { ascending: false });

    if (!error && data) {
      return data.map((t) => expandTask(t as Task, userList));
    }
  } catch {
    // Fallback
  }
  return localTasks.filter((t) => t.status === status);
}

export async function createTask(data: {
  task_id: string;
  body: string;
  assigned_to: string;
}): Promise<Task> {
  const taskId = 'task_' + Date.now();
  const newTask: Task = {
    id: taskId,
    task_id: data.task_id,
    body: data.body,
    assigned_to: data.assigned_to,
    status: 'assigned',
    member_verdict: '',
    member_verdict_date: '',
    admin_verdict: '',
    admin_verdict_date: '',
    admin_notes: '',
    payment_status: 'not_applicable',
    payment_amount_usd: 0,
    payment_date: '',
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
  };

  try {
    const { error } = await supabase.from('tasks').insert([newTask]);
    if (!error) {
      const expanded = expandTask(newTask, localUsers);
      localTasks.unshift(expanded);
      saveLocalState();
      return expanded;
    }
  } catch {
    // Fallback
  }

  const assignedUser = localUsers.find((u) => u.id === data.assigned_to);
  newTask.expand = { assigned_to: assignedUser };
  localTasks.unshift(newTask);
  saveLocalState();
  return newTask;
}

export async function updateTask(id: string, data: Partial<Task>): Promise<Task> {
  const updatedFields = { ...data, updated: new Date().toISOString() };
  delete updatedFields.expand;

  try {
    const { data: updatedData, error } = await supabase
      .from('tasks')
      .update(updatedFields)
      .eq('id', id)
      .select('*')
      .single();

    if (!error && updatedData) {
      const expanded = expandTask(updatedData as Task, localUsers);
      const idx = localTasks.findIndex((t) => t.id === id);
      if (idx !== -1) localTasks[idx] = expanded;
      saveLocalState();
      return expanded;
    }
  } catch {
    // Fallback
  }

  const idx = localTasks.findIndex((t) => t.id === id);
  if (idx !== -1) {
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

export async function deleteTask(id: string): Promise<void> {
  try {
    await supabase.from('tasks').delete().eq('id', id);
  } catch {
    // Fallback
  }
  localTasks = localTasks.filter((t) => t.id !== id);
  saveLocalState();
}

export async function deleteTasks(ids: string[]): Promise<void> {
  try {
    await supabase.from('tasks').delete().in('id', ids);
  } catch {
    // Fallback
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
      .ilike('task_id', taskId.trim());

    if (!error && data && data.length > 0) {
      const existing = data[0] as Task;
      const assignedTo = localUsers.find((u) => u.id === existing.assigned_to);
      return {
        isDuplicate: true,
        existingTask: existing,
        assignedToName: assignedTo?.name || 'Unknown Member',
      };
    }
  } catch {
    // Fallback
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
      .select('*')
      .eq('role', 'member')
      .order('name');

    if (!error && data && data.length > 0) {
      localUsers = deduplicateUsers(data as User[]);
      saveLocalState();
      return localUsers.filter((u) => u.role === 'member');
    }
  } catch {
    // Fallback
  }
  return deduplicateUsers(localUsers.filter((u) => u.role === 'member'));
}

export async function fetchAllUsers(): Promise<User[]> {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .order('name');

    if (!error && data && data.length > 0) {
      localUsers = deduplicateUsers(data as User[]);
      saveLocalState();
      return localUsers;
    }
  } catch {
    // Fallback
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
  const userId = 'user_' + Date.now();

  const newUser: User = {
    id: userId,
    username: data.username.trim(),
    email: data.email || `${data.username.trim()}@agnus.local`,
    name: data.name.trim(),
    role: data.role as 'admin' | 'member',
    avatar: '',
    is_active: true,
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
  };

  if (data.password) {
    localPasswords[cleanUsername] = data.password.trim();
  }

  try {
    const { data: createdData, error } = await supabase
      .from('users')
      .insert([{ ...newUser, password: data.password }])
      .select('*')
      .single();

    if (!error && createdData) {
      const u = createdData as User;
      localUsers.push(u);
      saveLocalState();
      return u;
    }
  } catch {
    // Fallback
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
  try {
    const { data: updatedData, error } = await supabase
      .from('users')
      .update(data)
      .eq('id', id)
      .select('*')
      .single();

    if (!error && updatedData) {
      const u = updatedData as User;
      const idx = localUsers.findIndex((x) => x.id === id);
      if (idx !== -1) localUsers[idx] = u;
      saveLocalState();
      return u;
    }
  } catch {
    // Fallback
  }

  const idx = localUsers.findIndex((u) => u.id === id);
  if (idx !== -1) {
    const updated: User = { ...localUsers[idx], ...data, updated: new Date().toISOString() };
    if (data.password) {
      localPasswords[updated.username.trim().toLowerCase()] = data.password.trim();
    }
    localUsers[idx] = updated;
    saveLocalState();
    return updated;
  }
  throw new Error('User not found');
}

export async function deleteUser(id: string): Promise<void> {
  try {
    await supabase.from('users').delete().eq('id', id);
  } catch {
    // Fallback
  }
  localUsers = localUsers.filter((u) => u.id !== id);
  saveLocalState();
}

// ─── Settings ────────────────────────────────────────────────────────────────

export async function fetchSettings(): Promise<AppSettings> {
  try {
    const { data, error } = await supabase.from('settings').select('*').limit(1);
    if (!error && data && data.length > 0) {
      localSettings = data[0] as AppSettings;
      saveLocalState();
      return localSettings;
    }
  } catch {
    // Fallback
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

    if (!error && updatedData) {
      localSettings = updatedData as AppSettings;
      saveLocalState();
      return localSettings;
    }
  } catch {
    // Fallback
  }

  localSettings = { ...localSettings, ...data, updated: new Date().toISOString() };
  saveLocalState();
  return localSettings;
}

export function exportLocalBackup(): string {
  const backupData = {
    version: 1,
    timestamp: new Date().toISOString(),
    tasks: localTasks,
    users: localUsers,
    passwords: localPasswords,
    settings: localSettings,
  };
  return JSON.stringify(backupData, null, 2);
}

export function importLocalBackup(jsonStr: string): { tasks: Task[]; users: User[]; settings: AppSettings } {
  const parsed = JSON.parse(jsonStr);
  if (Array.isArray(parsed.tasks)) localTasks = parsed.tasks;
  if (Array.isArray(parsed.users)) localUsers = deduplicateUsers(parsed.users);
  if (parsed.passwords && typeof parsed.passwords === 'object') localPasswords = parsed.passwords;
  if (parsed.settings && typeof parsed.settings === 'object') localSettings = parsed.settings;
  saveLocalState();

  // Sync imported data to Supabase Cloud
  try {
    supabase.from('users').upsert(localUsers).then(() => {});
    supabase.from('tasks').upsert(localTasks).then(() => {});
  } catch {
    // Ignore
  }

  return { tasks: localTasks, users: localUsers, settings: localSettings };
}

// ─── Realtime Subscriptions ──────────────────────────────────────────────────

export function subscribeToTasks(callback: (data: { action: string; record: Task }) => void) {
  try {
    const channel = supabase
      .channel('public:tasks')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, (payload) => {
        callback({ action: payload.eventType, record: payload.new as Task });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  } catch {
    return () => {};
  }
}

export function unsubscribeFromTasks() {
  try {
    supabase.removeAllChannels();
  } catch {
    // Ignore
  }
}
