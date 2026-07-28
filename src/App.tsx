import { useEffect, useState } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore, useLanguageStore, useAppStore } from './store';
import { restoreSession } from './api/auth';
import { fetchTasks, fetchAllUsers, fetchSettings } from './api/tasks';
import AppShell from './components/layout/AppShell';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import UploadTasks from './pages/UploadTasks';
import AllTasks from './pages/AllTasks';
import MemberView from './pages/MemberView';
import StatusView from './pages/StatusView';
import Payments from './pages/Payments';
import Settings from './pages/Settings';

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
  const { setTasks, setMembers, setSettings } = useAppStore();
  const [loading, setLoading] = useState(true);

  // Restore session on mount
  useEffect(() => {
    restoreSession();
    // Set document direction based on stored language
    document.documentElement.dir = language === 'fa' ? 'rtl' : 'ltr';
    document.documentElement.lang = language;
    setLoading(false);
  }, []);

  // Load data when authenticated
  useEffect(() => {
    if (!isAuthenticated) return;

    const loadData = async () => {
      try {
        const [tasks, users, settings] = await Promise.all([
          fetchTasks(),
          fetchAllUsers(),
          fetchSettings(),
        ]);
        setTasks(tasks);
        setMembers(users);
        setSettings(settings);
      } catch (err) {
        console.error('Failed to load data:', err);
      }
    };

    loadData();
  }, [isAuthenticated, setTasks, setMembers, setSettings]);

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        fontFamily: 'var(--font-en)',
        color: 'var(--color-text-secondary)',
      }}>
        Loading...
      </div>
    );
  }

  return (
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
        <Route
          path="/my-tasks"
          element={<StatusView />}
        />
        <Route path="/working" element={<StatusView />} />
        <Route path="/my-history/:status" element={<StatusView />} />
        <Route path="/my-payments" element={<Payments />} />
      </Route>
      
      {/* Catch-all */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <HashRouter>
      <AppContent />
    </HashRouter>
  );
}
