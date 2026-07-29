import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Language, User, Task, AppSettings, MemberStats, TaskStatus } from '../types';
import en from '../i18n/en.json';
import fa from '../i18n/fa.json';

const translations = { en, fa } as const;

function publicUser(user: User): User {
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

// ─── Language Store ──────────────────────────────────────────────────────────

interface LanguageState {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
}

export const useLanguageStore = create<LanguageState>()(
  persist(
    (set, get) => ({
      language: 'en',
      setLanguage: (language) => {
        document.documentElement.dir = language === 'fa' ? 'rtl' : 'ltr';
        document.documentElement.lang = language;
        set({ language });
      },
      t: (key: string) => {
        const lang = get().language;
        const keys = key.split('.');
        let result: unknown = translations[lang];
        for (const k of keys) {
          if (result && typeof result === 'object' && k in result) {
            result = (result as Record<string, unknown>)[k];
          } else {
            return key;
          }
        }
        return typeof result === 'string' ? result : key;
      },
    }),
    { name: 'agnus-language' }
  )
);

// ─── Auth Store ──────────────────────────────────────────────────────────────

interface AuthState {
  user: User | null;
  token: string;
  isAuthenticated: boolean;
  login: (user: User, token: string) => void;
  logout: () => void;
  updateUser: (user: User) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: '',
      isAuthenticated: false,
      login: (user, token) => set({ user: publicUser(user), token, isAuthenticated: true }),
      logout: () => set({ user: null, token: '', isAuthenticated: false }),
      updateUser: (user) => set({ user: publicUser(user) }),
    }),
    {
      name: 'agnus-auth',
      version: 1,
      migrate: (persisted) => {
        const state = persisted as Partial<AuthState>;
        return state.user ? { ...state, user: publicUser(state.user) } : state;
      },
    }
  )
);

// ─── App Store (Tasks, Members, Settings) ────────────────────────────────────

interface AppState {
  // Data
  tasks: Task[];
  trashedTasks: Task[];
  members: User[];
  settings: AppSettings;

  // UI State
  selectedTaskIds: string[];
  sidebarOpen: boolean;

  // Actions - Data
  setTasks: (tasks: Task[]) => void;
  addTask: (task: Task) => void;
  updateTask: (id: string, updates: Partial<Task>) => void;
  removeTask: (id: string) => void;
  removeTasks: (ids: string[]) => void;
  setTrashedTasks: (tasks: Task[]) => void;
  addTrashedTask: (task: Task) => void;
  removeTrashedTask: (id: string) => void;
  
  setMembers: (members: User[]) => void;
  addMember: (member: User) => void;
  updateMember: (id: string, updates: Partial<User>) => void;
  removeMember: (id: string) => void;
  
  setSettings: (settings: AppSettings) => void;

  // Actions - UI
  toggleTaskSelection: (id: string) => void;
  selectAllTasks: (ids: string[]) => void;
  clearSelection: () => void;
  setSidebarOpen: (open: boolean) => void;

  // Computed
  getTasksByStatus: (status: TaskStatus) => Task[];
  getTasksByMember: (memberId: string) => Task[];
  getMemberStats: (memberId: string) => MemberStats;
  checkDuplicate: (taskId: string) => { isDuplicate: boolean; assignedTo?: User };
}

const defaultSettings: AppSettings = {
  id: '1',
  usd_to_irr_rate: 580000,
  updated: new Date().toISOString(),
};

export const useAppStore = create<AppState>()((set, get) => ({
  tasks: [],
  trashedTasks: [],
  members: [],
  settings: defaultSettings,
  selectedTaskIds: [],
  sidebarOpen: false,

  setTasks: (tasks) =>
    set((s) => {
      const unique = tasks.filter(
        (task, index, all) =>
          !task.deleted_at && all.findIndex((item) => item.id === task.id) === index
      );
      return {
        tasks: unique.map((task) => ({
          ...task,
          expand: task.expand || {
            assigned_to: s.members.find((member) => member.id === task.assigned_to),
          },
        })),
      };
    }),
  addTask: (task) =>
    set((s) => {
      const expandedTask = {
        ...task,
        expand: task.expand || {
          assigned_to: s.members.find((member) => member.id === task.assigned_to),
        },
      };
      const exists = s.tasks.some((item) => item.id === task.id);
      return {
        tasks: exists
          ? s.tasks.map((item) => (item.id === task.id ? expandedTask : item))
          : [expandedTask, ...s.tasks],
      };
    }),
  updateTask: (id, updates) =>
    set((s) => ({
      tasks: s.tasks.map((task) => {
        if (task.id !== id) return task;
        const updated = { ...task, ...updates };
        if (updates.assigned_to) {
          updated.expand = {
            assigned_to: s.members.find((member) => member.id === updates.assigned_to),
          };
        }
        return updated;
      }),
    })),
  removeTask: (id) =>
    set((s) => ({
      tasks: s.tasks.filter((t) => t.id !== id),
      selectedTaskIds: s.selectedTaskIds.filter((sid) => sid !== id),
    })),
  removeTasks: (ids) =>
    set((s) => ({
      tasks: s.tasks.filter((t) => !ids.includes(t.id)),
      selectedTaskIds: [],
    })),
  setTrashedTasks: (tasks) =>
    set((state) => {
      const unique = tasks.filter(
        (task, index, all) =>
          Boolean(task.deleted_at) &&
          all.findIndex((item) => item.id === task.id) === index
      );
      return {
        trashedTasks: unique.map((task) => ({
          ...task,
          expand: task.expand || {
            assigned_to: state.members.find((member) => member.id === task.assigned_to),
          },
        })),
      };
    }),
  addTrashedTask: (task) =>
    set((state) => {
      const expandedTask = {
        ...task,
        expand: task.expand || {
          assigned_to: state.members.find((member) => member.id === task.assigned_to),
        },
      };
      return {
        trashedTasks: [
          expandedTask,
          ...state.trashedTasks.filter((item) => item.id !== task.id),
        ],
      };
    }),
  removeTrashedTask: (id) =>
    set((state) => ({
      trashedTasks: state.trashedTasks.filter((task) => task.id !== id),
    })),

  setMembers: (members) => {
    // Unique by id and username
    const unique = members.filter(
      (m, i, arr) => arr.findIndex((x) => x.id === m.id || x.username === m.username) === i
    );
    set((state) => ({
      members: unique,
      tasks: state.tasks.map((task) => ({
        ...task,
        expand: {
          assigned_to: unique.find((member) => member.id === task.assigned_to),
        },
      })),
      trashedTasks: state.trashedTasks.map((task) => ({
        ...task,
        expand: {
          assigned_to: unique.find((member) => member.id === task.assigned_to),
        },
      })),
    }));
  },
  addMember: (member) =>
    set((s) => {
      const exists = s.members.some((m) => m.id === member.id || m.username === member.username);
      if (exists) return { members: s.members.map((m) => (m.id === member.id || m.username === member.username ? member : m)) };
      return { members: [...s.members, member] };
    }),
  updateMember: (id, updates) =>
    set((s) => {
      const existingMember = s.members.find((member) => member.id === id);
      const updatedMember = existingMember
        ? { ...existingMember, ...updates } as User
        : undefined;
      return {
        members: s.members.map((member) => member.id === id ? updatedMember! : member),
        tasks: s.tasks.map((task) =>
          task.assigned_to === id
            ? { ...task, expand: { assigned_to: updatedMember } }
            : task
        ),
        trashedTasks: s.trashedTasks.map((task) =>
          task.assigned_to === id
            ? { ...task, expand: { assigned_to: updatedMember } }
            : task
        ),
      };
    }),
  removeMember: (id) =>
    set((s) => ({
      members: s.members.filter((m) => m.id !== id),
      tasks: s.tasks.map((task) =>
        task.assigned_to === id ? { ...task, expand: { assigned_to: undefined } } : task
      ),
      trashedTasks: s.trashedTasks.map((task) =>
        task.assigned_to === id ? { ...task, expand: { assigned_to: undefined } } : task
      ),
    })),

  setSettings: (settings) => set({ settings }),

  toggleTaskSelection: (id) =>
    set((s) => ({
      selectedTaskIds: s.selectedTaskIds.includes(id)
        ? s.selectedTaskIds.filter((sid) => sid !== id)
        : [...s.selectedTaskIds, id],
    })),
  selectAllTasks: (ids) => set({ selectedTaskIds: ids }),
  clearSelection: () => set({ selectedTaskIds: [] }),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),

  getTasksByStatus: (status) => get().tasks.filter((t) => t.status === status),
  getTasksByMember: (memberId) => get().tasks.filter((t) => t.assigned_to === memberId),
  getMemberStats: (memberId) => {
    const tasks = get().tasks.filter((t) => t.assigned_to === memberId);
    const member = get().members.find((m) => m.id === memberId);
    return {
      userId: memberId,
      name: member?.name || '',
      totalTasks: tasks.length,
      assigned: tasks.filter((t) => t.status === 'assigned').length,
      working: tasks.filter((t) => t.status === 'working').length,
      swf: tasks.filter((t) => t.status === 'swf').length,
      swof: tasks.filter((t) => t.status === 'swof').length,
      memberDiscarded: tasks.filter((t) => t.status === 'member_discarded').length,
      inStudio: tasks.filter((t) => t.status === 'in_studio').length,
      inReview: tasks.filter((t) => t.status === 'in_review').length,
      approved: tasks.filter((t) => t.status === 'approved').length,
      sentBack: tasks.filter((t) => t.status === 'sent_back').length,
      adminDiscarded: tasks.filter((t) => t.status === 'admin_discarded').length,
      onHold: tasks.filter((t) => t.status === 'on_hold').length,
      totalPaidUsd: tasks
        .filter((t) => t.payment_status === 'paid')
        .reduce((sum, t) => sum + t.payment_amount_usd, 0),
      totalPendingUsd: tasks
        .filter((t) => t.status === 'approved' && t.payment_status !== 'paid')
        .reduce((sum, t) => sum + t.payment_amount_usd, 0),
    };
  },
  checkDuplicate: (taskId) => {
    const normalizedTaskId = taskId.trim().toLocaleLowerCase('en-US');
    const existing = [...get().tasks, ...get().trashedTasks].find(
      (task) => task.task_id.trim().toLocaleLowerCase('en-US') === normalizedTaskId
    );
    if (!existing) return { isDuplicate: false };
    const member = get().members.find((m) => m.id === existing.assigned_to);
    return { isDuplicate: true, assignedTo: member };
  },
}));

// ─── Toast Store ─────────────────────────────────────────────────────────────

export interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'warning';
}

interface ToastState {
  toasts: Toast[];
  addToast: (message: string, type: Toast['type']) => void;
  removeToast: (id: string) => void;
}

export const useToastStore = create<ToastState>()((set) => ({
  toasts: [],
  addToast: (message, type) => {
    const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random()}`;
    set((s) => ({ toasts: [...s.toasts, { id, message, type }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, 4000);
  },
  removeToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
