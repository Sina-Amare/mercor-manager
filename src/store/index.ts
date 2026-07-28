import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Language, User, Task, AppSettings, MemberStats, TaskStatus } from '../types';
import en from '../i18n/en.json';
import fa from '../i18n/fa.json';

const translations = { en, fa } as const;

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
      login: (user, token) => set({ user, token, isAuthenticated: true }),
      logout: () => set({ user: null, token: '', isAuthenticated: false }),
      updateUser: (user) => set({ user }),
    }),
    { name: 'agnus-auth' }
  )
);

// ─── App Store (Tasks, Members, Settings) ────────────────────────────────────

interface AppState {
  // Data
  tasks: Task[];
  members: User[];
  settings: AppSettings;

  // UI State
  selectedTaskIds: string[];
  taskDetailId: string | null;
  sidebarOpen: boolean;

  // Actions - Data
  setTasks: (tasks: Task[]) => void;
  addTask: (task: Task) => void;
  updateTask: (id: string, updates: Partial<Task>) => void;
  removeTask: (id: string) => void;
  removeTasks: (ids: string[]) => void;
  
  setMembers: (members: User[]) => void;
  addMember: (member: User) => void;
  updateMember: (id: string, updates: Partial<User>) => void;
  
  setSettings: (settings: AppSettings) => void;

  // Actions - UI
  toggleTaskSelection: (id: string) => void;
  selectAllTasks: (ids: string[]) => void;
  clearSelection: () => void;
  setTaskDetail: (id: string | null) => void;
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
  members: [],
  settings: defaultSettings,
  selectedTaskIds: [],
  taskDetailId: null,
  sidebarOpen: true,

  setTasks: (tasks) => set({ tasks }),
  addTask: (task) => set((s) => ({ tasks: [task, ...s.tasks] })),
  updateTask: (id, updates) =>
    set((s) => ({
      tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...updates } : t)),
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

  setMembers: (members) => set({ members }),
  addMember: (member) => set((s) => ({ members: [...s.members, member] })),
  updateMember: (id, updates) =>
    set((s) => ({
      members: s.members.map((m) =>
        m.id === id ? { ...m, ...updates } as User : m
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
  setTaskDetail: (id) => set({ taskDetailId: id }),
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
    const existing = get().tasks.find((t) => t.task_id === taskId);
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
    const id = Date.now().toString();
    set((s) => ({ toasts: [...s.toasts, { id, message, type }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, 4000);
  },
  removeToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
