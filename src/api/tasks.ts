import pb from './pb';
import type { Task, User, TaskStatus, AppSettings } from '../types';
import { MOCK_TASKS, MOCK_USERS, MOCK_SETTINGS } from './mockData';

// ─── Local Cache for Standalone/Offline Mode ─────────────────────────────────

let localTasks: Task[] = [...MOCK_TASKS];
let localUsers: User[] = [...MOCK_USERS];
let localSettings: AppSettings = { ...MOCK_SETTINGS };

// Load from localStorage if available
try {
  const savedTasks = localStorage.getItem('agnus_local_tasks');
  if (savedTasks) localTasks = JSON.parse(savedTasks);
  const savedUsers = localStorage.getItem('agnus_local_users');
  if (savedUsers) localUsers = JSON.parse(savedUsers);
  const savedSettings = localStorage.getItem('agnus_local_settings');
  if (savedSettings) localSettings = JSON.parse(savedSettings);
} catch {
  // Ignore localStorage errors
}

function saveLocalState() {
  try {
    localStorage.setItem('agnus_local_tasks', JSON.stringify(localTasks));
    localStorage.setItem('agnus_local_users', JSON.stringify(localUsers));
    localStorage.setItem('agnus_local_settings', JSON.stringify(localSettings));
  } catch {
    // Ignore localStorage errors
  }
}

// ─── Tasks ───────────────────────────────────────────────────────────────────

export async function fetchTasks(): Promise<Task[]> {
  try {
    const records = await pb.collection('tasks').getFullList({
      sort: '-created',
      expand: 'assigned_to',
    });
    return records as unknown as Task[];
  } catch {
    return localTasks;
  }
}

export async function fetchTasksByMember(memberId: string): Promise<Task[]> {
  try {
    const records = await pb.collection('tasks').getFullList({
      filter: `assigned_to = "${memberId}"`,
      sort: '-created',
      expand: 'assigned_to',
    });
    return records as unknown as Task[];
  } catch {
    return localTasks.filter((t) => t.assigned_to === memberId);
  }
}

export async function fetchTasksByStatus(status: TaskStatus): Promise<Task[]> {
  try {
    const records = await pb.collection('tasks').getFullList({
      filter: `status = "${status}"`,
      sort: '-created',
      expand: 'assigned_to',
    });
    return records as unknown as Task[];
  } catch {
    return localTasks.filter((t) => t.status === status);
  }
}

export async function createTask(data: {
  task_id: string;
  body: string;
  assigned_to: string;
}): Promise<Task> {
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
}

export async function updateTask(id: string, data: Partial<Task>): Promise<Task> {
  try {
    const record = await pb.collection('tasks').update(id, data);
    const full = await pb.collection('tasks').getOne(record.id, { expand: 'assigned_to' });
    return full as unknown as Task;
  } catch {
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
}

export async function deleteTask(id: string): Promise<void> {
  try {
    await pb.collection('tasks').delete(id);
  } catch {
    localTasks = localTasks.filter((t) => t.id !== id);
    saveLocalState();
  }
}

export async function deleteTasks(ids: string[]): Promise<void> {
  try {
    await Promise.all(ids.map((id) => pb.collection('tasks').delete(id)));
  } catch {
    localTasks = localTasks.filter((t) => !ids.includes(t.id));
    saveLocalState();
  }
}

export async function checkDuplicateTaskId(
  taskId: string
): Promise<{ isDuplicate: boolean; existingTask?: Task; assignedToName?: string }> {
  try {
    const records = await pb.collection('tasks').getFullList({
      filter: `task_id = "${taskId}"`,
      expand: 'assigned_to',
    });
    if (records.length === 0) return { isDuplicate: false };
    const existing = records[0] as unknown as Task;
    const assignedTo = existing.expand?.assigned_to;
    return {
      isDuplicate: true,
      existingTask: existing,
      assignedToName: assignedTo?.name || 'Unknown',
    };
  } catch {
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
}

// ─── Users / Members ─────────────────────────────────────────────────────────

export async function fetchMembers(): Promise<User[]> {
  try {
    const records = await pb.collection('users').getFullList({
      filter: 'role = "member"',
      sort: 'name',
    });
    return records as unknown as User[];
  } catch {
    return localUsers.filter((u) => u.role === 'member');
  }
}

export async function fetchAllUsers(): Promise<User[]> {
  try {
    const records = await pb.collection('users').getFullList({ sort: 'name' });
    return records as unknown as User[];
  } catch {
    return localUsers;
  }
}

export async function createUser(data: {
  username: string;
  password: string;
  passwordConfirm: string;
  name: string;
  role: string;
  email?: string;
}): Promise<User> {
  try {
    const record = await pb.collection('users').create({
      ...data,
      is_active: true,
      emailVisibility: true,
    });
    return record as unknown as User;
  } catch {
    const newUser: User = {
      id: 'user_' + Date.now(),
      username: data.username,
      email: data.email || `${data.username}@agnus.local`,
      name: data.name,
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
}

export async function updateUser(
  id: string,
  data: Partial<User> & { password?: string; passwordConfirm?: string }
): Promise<User> {
  try {
    const record = await pb.collection('users').update(id, data);
    return record as unknown as User;
  } catch {
    const idx = localUsers.findIndex((u) => u.id === id);
    if (idx !== -1) {
      const updated: User = { ...localUsers[idx], ...data, updated: new Date().toISOString() };
      localUsers[idx] = updated;
      saveLocalState();
      return updated;
    }
    throw new Error('User not found');
  }
}

// ─── Settings ────────────────────────────────────────────────────────────────

export async function fetchSettings(): Promise<AppSettings> {
  try {
    const records = await pb.collection('settings').getFullList();
    if (records.length > 0) return records[0] as unknown as AppSettings;
  } catch {
    // Collection may not exist yet
  }
  return localSettings;
}

export async function updateSettings(
  id: string,
  data: Partial<AppSettings>
): Promise<AppSettings> {
  try {
    if (id) {
      const record = await pb.collection('settings').update(id, data);
      return record as unknown as AppSettings;
    } else {
      const record = await pb.collection('settings').create(data);
      return record as unknown as AppSettings;
    }
  } catch {
    localSettings = { ...localSettings, ...data, updated: new Date().toISOString() };
    saveLocalState();
    return localSettings;
  }
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
