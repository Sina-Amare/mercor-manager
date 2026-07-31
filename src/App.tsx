import { lazy, Suspense, useEffect, useState } from 'react';
import { HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuthStore, useLanguageStore, useAppStore, useToastStore } from './store';
import { initAuth, logout as signOut } from './api/auth';
import {
  fetchTasks,
  fetchDeletedTasks,
  fetchAllUsers,
  fetchSettings,
  subscribeToTasks,
  subscribeToUsers,
  subscribeToSettings,
} from './api/tasks';
import AppShell from './components/layout/AppShell';
import { MEMBER_ACTIVE_STATUSES, TASK_STATUSES } from './types';
import { rememberRoute } from './utils/lastRoute';

// Backstop reconcile interval. Realtime does the real work; this only catches
// the case where it has silently stopped delivering.
const RECONCILE_MS = 60_000;

const Login = lazy(() => import('./pages/Login'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const UploadTasks = lazy(() => import('./pages/UploadTasks'));
const AllTasks = lazy(() => import('./pages/AllTasks'));
const MemberView = lazy(() => import('./pages/MemberView'));
const StatusView = lazy(() => import('./pages/StatusView'));
const Payments = lazy(() => import('./pages/Payments'));
const Settings = lazy(() => import('./pages/Settings'));
const TaskWorkspace = lazy(() => import('./pages/TaskWorkspace'));
const Prompts = lazy(() => import('./pages/Prompts'));
const RecycleBin = lazy(() => import('./pages/RecycleBin'));

function LoadingScreen() {
  return (
    <div className="app-loading" role="status" aria-live="polite">
      Loading...
    </div>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuthStore();
  const location = useLocation();

  if (!isAuthenticated) {
    const path = location.pathname + location.search;
    rememberRoute(path);
    return <Navigate to="/login" replace state={{ from: path }} />;
  }
  return <>{children}</>;
}

/** Keeps the remembered route current while signed in. */
function RouteMemory() {
  const location = useLocation();
  const { isAuthenticated } = useAuthStore();
  useEffect(() => {
    if (isAuthenticated) rememberRoute(location.pathname + location.search);
  }, [isAuthenticated, location.pathname, location.search]);
  return null;
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore();
  if (user?.role !== 'admin') return <Navigate to="/" replace />;
  return <>{children}</>;
}

function AppContent() {
  const { isAuthenticated } = useAuthStore();
  const { language, t } = useLanguageStore();
  const {
    setTasks,
    setTrashedTasks,
    setMembers,
    setSettings,
    addTask,
    removeTask,
    addTrashedTask,
    removeTrashedTask,
    addMember,
    updateMember,
    removeMember,
  } = useAppStore();
  const { addToast } = useToastStore();
  const [loading, setLoading] = useState(true);

  // Follow the Supabase session for the life of the tab: first load, refresh,
  // and sign-out (including a sign-out performed in another tab).
  useEffect(() => initAuth(() => setLoading(false)), []);

  useEffect(() => {
    document.documentElement.dir = language === 'fa' ? 'rtl' : 'ltr';
    document.documentElement.lang = language;
  }, [language]);

  // Load data when authenticated
  useEffect(() => {
    if (!isAuthenticated) return;

    let active = true;
    const loadData = async () => {
      try {
        const sessionUser = useAuthStore.getState().user;
        const [tasks, trashedTasks, users, settings] = await Promise.all([
          fetchTasks(),
          sessionUser?.role === 'admin' ? fetchDeletedTasks() : Promise.resolve([]),
          fetchAllUsers(),
          fetchSettings(),
        ]);
        if (!active) return;
        const freshUser = users.find((candidate) => candidate.id === sessionUser?.id);
        if (!freshUser || !freshUser.is_active) {
          void signOut();
          addToast(t('common.account_inactive'), 'error');
          return;
        }
        useAuthStore.getState().updateUser(freshUser);
        setTasks(tasks);
        setTrashedTasks(trashedTasks);
        setMembers(users);
        setSettings(settings);
      } catch (err) {
        console.error('Failed to load data:', err);
        if (active) addToast(t('common.sync_error'), 'error');
      }
    };

    void loadData();
    return () => {
      active = false;
    };
  }, [
    addToast,
    isAuthenticated,
    setMembers,
    setSettings,
    setTasks,
    setTrashedTasks,
    t,
  ]);

  // Keep signed-in browsers synchronized with inserts, updates, and deletes.
  useEffect(() => {
    if (!isAuthenticated) return;

    let active = true;
    let refreshInFlight = false;
    let refreshQueued = false;
    let realtimeRevision = 0;

    const refreshTasks = async () => {
      if (refreshInFlight) {
        refreshQueued = true;
        return;
      }

      refreshInFlight = true;
      const revisionAtStart = realtimeRevision;
      try {
        const shouldLoadTrash = useAuthStore.getState().user?.role === 'admin';
        const [tasks, trashedTasks] = await Promise.all([
          fetchTasks(),
          shouldLoadTrash ? fetchDeletedTasks() : Promise.resolve([]),
        ]);
        // Do not overwrite a newer websocket event with an older request snapshot.
        if (active && revisionAtStart === realtimeRevision) {
          setTasks(tasks);
          setTrashedTasks(trashedTasks);
        }
      } catch (error) {
        console.error('Failed to synchronize tasks:', error);
      } finally {
        refreshInFlight = false;
        if (active && refreshQueued) {
          refreshQueued = false;
          void refreshTasks();
        }
      }
    };

    const unsubscribe = subscribeToTasks(
      ({ eventType, newTask, oldTask }) => {
        if (!active) return;
        realtimeRevision += 1;
        if (eventType === 'DELETE') {
          const deletedId = oldTask?.id;
          if (deletedId) {
            removeTask(deletedId);
            removeTrashedTask(deletedId);
          } else {
            void refreshTasks();
          }
          return;
        }
        if (newTask?.deleted_at) {
          removeTask(newTask.id);
          if (useAuthStore.getState().user?.role === 'admin') {
            addTrashedTask(newTask);
          } else {
            removeTrashedTask(newTask.id);
          }
        } else if (newTask) {
          removeTrashedTask(newTask.id);
          addTask(newTask);
        }
      },
      (status) => {
        if (status === 'SUBSCRIBED') {
          // Reconcile anything written between the initial fetch and subscription,
          // and anything missed during a reconnect.
          void refreshTasks();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          void refreshTasks();
        }
      }
    );

    const handleFocus = () => void refreshTasks();
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void refreshTasks();
    };
    // Realtime is the delivery mechanism; this is the backstop for when it
    // silently stops — a slept laptop, a dropped socket, a broken publication.
    // The original 4-second poll cost ~15 full table reads a minute per tab and
    // masked exactly that class of fault. Removing it entirely was worse: a
    // stale screen with no upper bound. A minute caps the damage for 1/15th of
    // the traffic.
    const backstop = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshTasks();
    }, RECONCILE_MS);

    window.addEventListener('focus', handleFocus);
    window.addEventListener('online', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      active = false;
      window.clearInterval(backstop);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('online', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
      unsubscribe();
    };
  }, [
    addTask,
    addTrashedTask,
    isAuthenticated,
    removeTask,
    removeTrashedTask,
    setTasks,
    setTrashedTasks,
  ]);

  // Keep users and shared settings synchronized across browsers and devices.
  useEffect(() => {
    if (!isAuthenticated) return;

    let active = true;
    let usersRefreshInFlight = false;
    let usersRefreshQueued = false;
    let usersRealtimeRevision = 0;
    let settingsRefreshInFlight = false;
    let settingsRefreshQueued = false;
    let settingsRealtimeRevision = 0;

    const updateSessionUser = (users: Awaited<ReturnType<typeof fetchAllUsers>>) => {
      const authStore = useAuthStore.getState();
      const sessionUser = authStore.user;
      if (!sessionUser) return false;

      const freshUser = users.find((candidate) => candidate.id === sessionUser.id);
      if (!freshUser || !freshUser.is_active) {
        void signOut();
        addToast(t('common.account_removed'), 'error');
        return false;
      }

      if (
        freshUser.updated !== sessionUser.updated ||
        freshUser.username !== sessionUser.username ||
        freshUser.name !== sessionUser.name ||
        freshUser.role !== sessionUser.role ||
        freshUser.is_active !== sessionUser.is_active
      ) {
        authStore.updateUser(freshUser);
      }
      return true;
    };

    const refreshUsers = async () => {
      if (usersRefreshInFlight) {
        usersRefreshQueued = true;
        return;
      }

      usersRefreshInFlight = true;
      const revisionAtStart = usersRealtimeRevision;
      try {
        const users = await fetchAllUsers();
        if (
          active &&
          revisionAtStart === usersRealtimeRevision &&
          updateSessionUser(users)
        ) {
          setMembers(users);
        }
      } catch (error) {
        console.error('Failed to synchronize users:', error);
      } finally {
        usersRefreshInFlight = false;
        if (active && usersRefreshQueued) {
          usersRefreshQueued = false;
          void refreshUsers();
        }
      }
    };

    const refreshSettings = async () => {
      if (settingsRefreshInFlight) {
        settingsRefreshQueued = true;
        return;
      }

      settingsRefreshInFlight = true;
      const revisionAtStart = settingsRealtimeRevision;
      try {
        const settings = await fetchSettings();
        if (active && revisionAtStart === settingsRealtimeRevision) {
          setSettings(settings);
        }
      } catch (error) {
        console.error('Failed to synchronize settings:', error);
      } finally {
        settingsRefreshInFlight = false;
        if (active && settingsRefreshQueued) {
          settingsRefreshQueued = false;
          void refreshSettings();
        }
      }
    };

    const handleSubscriptionStatus = (refresh: () => Promise<void>) => (status: string) => {
      if (
        status === 'SUBSCRIBED' ||
        status === 'CHANNEL_ERROR' ||
        status === 'TIMED_OUT' ||
        status === 'CLOSED'
      ) {
        void refresh();
      }
    };

    const unsubscribeUsers = subscribeToUsers(
      ({ eventType, newUser, oldUser }) => {
        if (!active) return;
        usersRealtimeRevision += 1;

        const affectedUserId = newUser?.id || oldUser?.id;
        const sessionUser = useAuthStore.getState().user;
        if (affectedUserId && affectedUserId === sessionUser?.id) {
          if (eventType === 'DELETE' || !newUser?.is_active) {
            void signOut();
            addToast(t('common.account_removed'), 'error');
            return;
          }
          if (newUser) useAuthStore.getState().updateUser(newUser);
        }

        if (eventType === 'DELETE') {
          if (affectedUserId) removeMember(affectedUserId);
        } else if (newUser) {
          if (eventType === 'INSERT') addMember(newUser);
          else updateMember(newUser.id, newUser);
        }

        // Reconcile the complete list in case the websocket payload was partial.
        void refreshUsers();
      },
      handleSubscriptionStatus(refreshUsers)
    );

    const unsubscribeSettings = subscribeToSettings(
      ({ eventType, newSettings }) => {
        if (!active) return;
        settingsRealtimeRevision += 1;
        if (eventType !== 'DELETE' && newSettings) setSettings(newSettings);
        void refreshSettings();
      },
      handleSubscriptionStatus(refreshSettings)
    );

    const refreshSharedData = () => {
      void refreshUsers();
      void refreshSettings();
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') refreshSharedData();
    };
    const backstop = window.setInterval(() => {
      if (document.visibilityState === 'visible') refreshSharedData();
    }, RECONCILE_MS);

    window.addEventListener('focus', refreshSharedData);
    window.addEventListener('online', refreshSharedData);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      active = false;
      window.clearInterval(backstop);
      window.removeEventListener('focus', refreshSharedData);
      window.removeEventListener('online', refreshSharedData);
      document.removeEventListener('visibilitychange', handleVisibility);
      unsubscribeUsers();
      unsubscribeSettings();
    };
  }, [
    addMember,
    addToast,
    isAuthenticated,
    removeMember,
    setMembers,
    setSettings,
    t,
    updateMember,
  ]);

  if (loading) {
    return <LoadingScreen />;
  }

  return (
    <Suspense fallback={<LoadingScreen />}>
      <RouteMemory />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          element={
            <ProtectedRoute>
              <AppShell />
            </ProtectedRoute>
          }
        >
          <Route path="/" element={<Dashboard />} />

          {/* Admin Routes */}
          <Route path="/upload" element={<AdminRoute><UploadTasks /></AdminRoute>} />
          <Route path="/tasks" element={<AdminRoute><AllTasks /></AdminRoute>} />
          <Route path="/member/:memberId" element={<AdminRoute><MemberView /></AdminRoute>} />
          <Route path="/settings" element={<AdminRoute><Settings /></AdminRoute>} />
          <Route path="/recycle-bin" element={<AdminRoute><RecycleBin /></AdminRoute>} />

          {/* Shared Routes */}
          <Route path="/status/:status" element={<StatusView />} />
          <Route path="/payments" element={<Payments />} />
          <Route path="/task/:taskId" element={<TaskWorkspace />} />
          <Route path="/prompts" element={<Prompts />} />

          {/* Member Routes */}
          <Route
            path="/my-tasks"
            element={<StatusView fixedStatuses={TASK_STATUSES} titleKey="nav.my_tasks" />}
          />
          <Route
            path="/working"
            element={
              <StatusView
                fixedStatuses={MEMBER_ACTIVE_STATUSES}
                titleKey="nav.working"
              />
            }
          />
          <Route path="/my-history/:status" element={<StatusView />} />
          <Route path="/my-payments" element={<Payments />} />
        </Route>

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <HashRouter>
      <AppContent />
    </HashRouter>
  );
}
