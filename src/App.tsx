import { lazy, Suspense, useEffect, useState } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore, useLanguageStore, useAppStore, useToastStore } from './store';
import { restoreSession } from './api/auth';
import { fetchTasks, fetchAllUsers, fetchSettings, subscribeToTasks } from './api/tasks';
import AppShell from './components/layout/AppShell';

const Login = lazy(() => import('./pages/Login'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const UploadTasks = lazy(() => import('./pages/UploadTasks'));
const AllTasks = lazy(() => import('./pages/AllTasks'));
const MemberView = lazy(() => import('./pages/MemberView'));
const StatusView = lazy(() => import('./pages/StatusView'));
const Payments = lazy(() => import('./pages/Payments'));
const Settings = lazy(() => import('./pages/Settings'));

function LoadingScreen() {
  return (
    <div className="app-loading" role="status" aria-live="polite">
      Loading...
    </div>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuthStore();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore();
  if (user?.role !== 'admin') return <Navigate to="/" replace />;
  return <>{children}</>;
}

function AppContent() {
  const { isAuthenticated } = useAuthStore();
  const { language } = useLanguageStore();
  const { setTasks, setMembers, setSettings, addTask, removeTask } = useAppStore();
  const { addToast } = useToastStore();
  const [loading, setLoading] = useState(true);

  // Restore session on mount
  useEffect(() => {
    restoreSession();
    setLoading(false);
  }, []);

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
        const [tasks, users, settings] = await Promise.all([
          fetchTasks(),
          fetchAllUsers(),
          fetchSettings(),
        ]);
        if (!active) return;
        const sessionUser = useAuthStore.getState().user;
        const freshUser = users.find((candidate) => candidate.id === sessionUser?.id);
        if (!freshUser || !freshUser.is_active) {
          useAuthStore.getState().logout();
          addToast('Your account is no longer active', 'error');
          return;
        }
        useAuthStore.getState().updateUser(freshUser);
        setTasks(tasks);
        setMembers(users);
        setSettings(settings);
      } catch (err) {
        console.error('Failed to load data:', err);
        if (active) addToast('Could not sync data with Supabase', 'error');
      }
    };

    void loadData();
    return () => {
      active = false;
    };
  }, [addToast, isAuthenticated, setTasks, setMembers, setSettings]);

  // Keep signed-in browsers synchronized with inserts, updates, and deletes.
  useEffect(() => {
    if (!isAuthenticated) return;

    let active = true;
    const refreshTasks = async () => {
      try {
        const tasks = await fetchTasks();
        if (active) setTasks(tasks);
      } catch (error) {
        console.error('Failed to refresh tasks after realtime reconnect:', error);
      }
    };

    const unsubscribe = subscribeToTasks(
      ({ eventType, newTask, oldTask }) => {
        if (!active) return;
        if (eventType === 'DELETE') {
          const deletedId = oldTask?.id;
          if (deletedId) removeTask(deletedId);
          return;
        }
        if (newTask) addTask(newTask);
      },
      (status) => {
        if (status === 'SUBSCRIBED') {
          // Reconcile anything written between the initial fetch and subscription,
          // and anything missed during a reconnect.
          void refreshTasks();
        }
      }
    );

    const handleFocus = () => void refreshTasks();
    window.addEventListener('focus', handleFocus);

    return () => {
      active = false;
      window.removeEventListener('focus', handleFocus);
      unsubscribe();
    };
  }, [addTask, isAuthenticated, removeTask, setTasks]);

  if (loading) {
    return <LoadingScreen />;
  }

  return (
    <Suspense fallback={<LoadingScreen />}>
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

          {/* Shared Routes */}
          <Route path="/status/:status" element={<StatusView />} />
          <Route path="/payments" element={<Payments />} />

          {/* Member Routes */}
          <Route path="/my-tasks" element={<StatusView fixedStatus="assigned" titleKey="nav.my_tasks" />} />
          <Route
            path="/working"
            element={<StatusView fixedStatuses={['working', 'sent_back']} titleKey="nav.working" />}
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
