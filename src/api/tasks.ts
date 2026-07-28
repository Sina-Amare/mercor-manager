import pb from './pb';
import type { Task, User, TaskStatus, AppSettings } from '../types';
import { MOCK_TASKS, MOCK_USERS, MOCK_SETTINGS } from './mockData';

// ─── Local Cache & Deduplication ──────────────────────────────────────────────

let localTasks: Task[] = [...MOCK_TASKS];
let localUsers: User[] = [...MOCK_USERS];
let localSettings: AppSettings = { ...MOCK_SETTINGS };

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
} catch {
  // Ignore localStorage errors
}

function saveLocalState() {
  try {
    localUsers = deduplicateUsers(localUsers);
    localStorage.setItem('agnus_local_tasks', JSON.stringify(localTasks));
    localStorage.setItem('agnus_local_users', JSON.stringify(localUsers));
    localStorage.setItem('agnus_local_settings', JSON.stringify(localSettings));
  } catch {
    // Ignore localStorage errors
  }
}

// ─── Instant PocketBase Connectivity Check (prevents 10s timeout delays) ─────

let pbConnected: boolean | null = null;

async function isPBOnline(): Promise<boolean> {
  if (pbConnected !== null) return pbConnected;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 400);
    const res = await fetch(`${pb.baseUrl}/api/health`, { signal: controller.signal });
    clearTimeout(timeoutId);
    pbConnected = res.ok;
  } catch {
    pbConnected = false;
  }
  return pbConnected;
}

// ─── Tasks ───────────────────────────────────────────────────────────────────

export async function fetchTasks(): Promise<Task[]> {
  if (await isPBOnline()) {
    try {
      const records = await pb.collection('tasks').getFullList({
        sort: '-created',
        expand: 'assigned_to',
      });
      return records as unknown as Task[];
    } catch {
      // Fallback
    }
  }
  return localTasks;
}

export async function fetchTasksByMember(memberId: string): Promise<Task[]> {
  if (await isPBOnline()) {
    try {
      const records = await pb.collection('tasks').getFullList({
        filter: `assigned_to = "${memberId}"`,
        sort: '-created',
        expand: 'assigned_to',
      });
      return records as unknown as Task[];
    } catch {
      // Fallback
    }
  }
  return localTasks.filter((t) => t.assigned_to === memberId);
}

export async function fetchTasksByStatus(status: TaskStatus): Promise<Task[]> {
  if (await isPBOnline()) {
    try {
      const records = await pb.collection('tasks').getFullList({
        filter: `status = "${status}"`,
        sort: '-created',
        expand: 'assigned_to',
      });
      return records as unknown as Task[];
    } catch {
      // Fallback
    }
  }
  return localTasks.filter((t) => t.status === status);
}

export async function createTask(data: {
  task_id: string;
  body: string;
  assigned_to: string;
}): Promise<Task> {
  if (await isPBOnline()) {
    try {
      const record = await pb.collection('tasks').create({
        ...data,
        status: 'assigned',
        member_verdict: '',
        admin_verdict: '',
        admin_notes: '',
        payment_status: 'not_applicable',
        payment_amount_usd: 0,
      });
      const full = await pb.collection('tasks').getOne(record.id, { expand: 'assigned_to' });
      return full as unknown as Task;
    } catch {
      // Fallback
    }
  }

  const assignedUser = localUsers.find((u) => u.id === data.assigned_to);
  const newTask: Task = {
    id: 'task_' + Date.now(),
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
    expand: { assigned_to: assignedUser },
  };
  localTasks.unshift(newTask);
  saveLocalState();
  return newTask;
}

export async function updateTask(id: string, data: Partial<Task>): Promise<Task> {
  if (await isPBOnline()) {
    try {
      const record = await pb.collection('tasks').update(id, data);
      const full = await pb.collection('tasks').getOne(record.id, { expand: 'assigned_to' });
      return full as unknown as Task;
    } catch {
      // Fallback
    }
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
  if (await isPBOnline()) {
    try {
      await pb.collection('tasks').delete(id);
    } catch {
      // Fallback
    }
  }
  localTasks = localTasks.filter((t) => t.id !== id);
  saveLocalState();
}

export async function deleteTasks(ids: string[]): Promise<void> {
  if (await isPBOnline()) {
    try {
      await Promise.all(ids.map((id) => pb.collection('tasks').delete(id)));
    } catch {
      // Fallback
    }
  }
  localTasks = localTasks.filter((t) => !ids.includes(t.id));
  saveLocalState();
}

export async function checkDuplicateTaskId(
  taskId: string
): Promise<{ isDuplicate: boolean; existingTask?: Task; assignedToName?: string }> {
  if (await isPBOnline()) {
    try {
      const records = await pb.collection('tasks').getFullList({
        filter: `task_id = "${taskId}"`,
        expand: 'assigned_to',
      });
      if (records.length > 0) {
        const existing = records[0] as unknown as Task;
        const assignedTo = existing.expand?.assigned_to;
        return {
          isDuplicate: true,
          existingTask: existing,
          assignedToName: assignedTo?.name || 'Unknown',
        };
      }
      return { isDuplicate: false };
    } catch {
      // Fallback
    }
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
  if (await isPBOnline()) {
    try {
      const records = await pb.collection('users').getFullList({
        filter: 'role = "member"',
        sort: 'name',
      });
      return deduplicateUsers(records as unknown as User[]);
    } catch {
      // Fallback
    }
  }
  return deduplicateUsers(localUsers.filter((u) => u.role === 'member'));
}

export async function fetchAllUsers(): Promise<User[]> {
  if (await isPBOnline()) {
    try {
      const records = await pb.collection('users').getFullList({ sort: 'name' });
      return deduplicateUsers(records as unknown as User[]);
    } catch {
      // Fallback
    }
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
  if (await isPBOnline()) {
    try {
      const record = await pb.collection('users').create({
        ...data,
        is_active: true,
        emailVisibility: true,
      });
      return record as unknown as User;
    } catch {
      // Fallback
    }
  }

  // Deduplicate by username in offline mode
  const existingIdx = localUsers.findIndex(
    (u) => u.username.toLowerCase() === data.username.trim().toLowerCase()
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

  const newUser: User = {
    id: 'user_' + Date.now(),
    username: data.username.trim(),
    email: data.email || `${data.username.trim()}@agnus.local`,
    name: data.name.trim(),
    role: data.role as 'admin' | 'member',
    avatar: '',
    is_active: true,
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
  };
  localUsers.push(newUser);
  saveLocalState();
  return newUser;
}

export async function updateUser(
  id: string,
  data: Partial<User> & { password?: string; passwordConfirm?: string }
): Promise<User> {
  if (await isPBOnline()) {
    try {
      const record = await pb.collection('users').update(id, data);
      return record as unknown as User;
    } catch {
      // Fallback
    }
  }

  const idx = localUsers.findIndex((u) => u.id === id);
  if (idx !== -1) {
    const updated: User = { ...localUsers[idx], ...data, updated: new Date().toISOString() };
    localUsers[idx] = updated;
    saveLocalState();
    return updated;
  }
  throw new Error('User not found');
}

export async function deleteUser(id: string): Promise<void> {
  if (await isPBOnline()) {
    try {
      await pb.collection('users').delete(id);
    } catch {
      // Fallback
    }
  }
  localUsers = localUsers.filter((u) => u.id !== id);
  saveLocalState();
}

// ─── Settings ────────────────────────────────────────────────────────────────

export async function fetchSettings(): Promise<AppSettings> {
  if (await isPBOnline()) {
    try {
      const records = await pb.collection('settings').getFullList();
      if (records.length > 0) return records[0] as unknown as AppSettings;
    } catch {
      // Fallback
    }
  }
  return localSettings;
}

export async function updateSettings(
  id: string,
  data: Partial<AppSettings>
): Promise<AppSettings> {
  if (await isPBOnline()) {
    try {
      if (id) {
        const record = await pb.collection('settings').update(id, data);
        return record as unknown as AppSettings;
      } else {
        const record = await pb.collection('settings').create(data);
        return record as unknown as AppSettings;
      }
    } catch {
      // Fallback
    }
  }

  localSettings = { ...localSettings, ...data, updated: new Date().toISOString() };
  saveLocalState();
  return localSettings;
}

// ─── Realtime Subscriptions ──────────────────────────────────────────────────

export function subscribeToTasks(callback: (data: { action: string; record: Task }) => void) {
  try {
    return pb.collection('tasks').subscribe('*', (e) => {
      callback({ action: e.action, record: e.record as unknown as Task });
    });
  } catch {
    return () => {};
  }
}

export function unsubscribeFromTasks() {
  try {
    pb.collection('tasks').unsubscribe('*');
  } catch {
    // Ignore
  }
}
