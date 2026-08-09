import { NavLink, useNavigate } from 'react-router-dom';
import {
  CalendarRange,
  LayoutDashboard,
  Upload,
  ListTodo,
  Users,
  CreditCard,
  Settings,
  LogOut,
  ClipboardList,
  Wallet,
  Menu,
  X,
  ChevronRight,
  MessageSquareText,
  Trash2,
} from 'lucide-react';
import { useAuthStore, useLanguageStore, useAppStore } from '../../store';
import { logout } from '../../api/auth';
import { useEffect, useState } from 'react';
import { formatNumber } from '../../utils/dates';
import ConfirmDialog from '../shared/ConfirmDialog';
import QueueNav from './QueueNav';
import { queuesFor } from '../../queues';

export default function Sidebar() {
  const { user } = useAuthStore();
  const { t, language } = useLanguageStore();
  const { sidebarOpen, setSidebarOpen, members, tasks, trashedTasks } = useAppStore();
  const navigate = useNavigate();
  const isAdmin = user?.role === 'admin';
  const teamMembers = members.filter((member) => member.role === 'member' && member.is_active);

  const [membersOpen, setMembersOpen] = useState(true);
  const [showLogoutModal, setShowLogoutModal] = useState(false);

  const confirmLogout = async () => {
    await logout();
    setShowLogoutModal(false);
    navigate('/login');
  };

  // Signing out is cheap to undo — you sign back in. It only asks first when
  // there is unsaved work on this device that signing out would strand.
  const handleLogoutClick = () => {
    const hasDrafts = (() => {
      try {
        for (let index = 0; index < window.sessionStorage.length; index += 1) {
          if (window.sessionStorage.key(index)?.startsWith('agnus:draft:')) return true;
        }
      } catch {
        // Storage unavailable: fall back to asking.
        return true;
      }
      return false;
    })();

    if (hasDrafts) setShowLogoutModal(true);
    else void confirmLogout();
  };

  const getMemberTaskCount = (memberId: string) =>
    tasks.filter((t) => t.assigned_to === memberId).length;

  const handleSidebarClick = (event: React.MouseEvent<HTMLElement>) => {
    if (
      (event.target as HTMLElement).closest('a') &&
      window.matchMedia('(max-width: 768px)').matches
    ) {
      setSidebarOpen(false);
    }
  };

  useEffect(() => {
    if (!sidebarOpen || !window.matchMedia('(max-width: 768px)').matches) return;

    const previousOverflow = document.body.style.overflow;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSidebarOpen(false);
    };

    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleEscape);
    };
  }, [setSidebarOpen, sidebarOpen]);

  useEffect(() => {
    const mobileViewport = window.matchMedia('(max-width: 768px)');
    const handleViewportChange = (event: MediaQueryListEvent) => {
      if (!event.matches) setSidebarOpen(false);
    };

    mobileViewport.addEventListener('change', handleViewportChange);
    return () => mobileViewport.removeEventListener('change', handleViewportChange);
  }, [setSidebarOpen]);

  return (
    <>
      <button
        type="button"
        className={`sidebar-mobile-toggle btn btn-icon btn-ghost ${sidebarOpen ? 'is-open' : ''}`}
        onClick={() => setSidebarOpen(!sidebarOpen)}
        aria-label={sidebarOpen ? t('common.close_navigation') : t('common.open_navigation')}
        aria-expanded={sidebarOpen}
      >
        {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
      </button>

      {sidebarOpen && (
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label={t('common.close_navigation')}
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={`sidebar ${sidebarOpen ? 'open' : ''}`}
        data-mobile-open={sidebarOpen}
        onClick={handleSidebarClick}
        aria-label={t('common.primary_navigation')}
      >
        {/* Brand Header */}
        <div className="sidebar-logo">
          <div className="sidebar-logo-icon">A</div>
          <div>
            <span className="sidebar-logo-text">{t('app_name')}</span>
            <span className="sidebar-logo-sub">{t('app_subtitle')}</span>
          </div>
        </div>

        {isAdmin ? (
          /* Admin Menu */
          <>
            <div className="sidebar-section">
              <div className="sidebar-section-title">{t('nav.main_workspace')}</div>
              <ul className="sidebar-nav">
                <li>
                  <NavLink to="/" end className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
                    <LayoutDashboard size={18} className="sidebar-link-icon" />
                    {t('nav.dashboard')}
                  </NavLink>
                </li>
                <li>
                  <NavLink to="/upload" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
                    <Upload size={18} className="sidebar-link-icon" />
                    {t('nav.upload_tasks')}
                  </NavLink>
                </li>
                <li>
                  <NavLink to="/tasks" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
                    <ListTodo size={18} className="sidebar-link-icon" />
                    {t('nav.all_tasks')}
                    <span className="sidebar-link-badge">{formatNumber(tasks.length, language)}</span>
                  </NavLink>
                </li>
                <li>
                  <NavLink to="/prompts" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
                    <MessageSquareText size={18} className="sidebar-link-icon" />
                    {t('nav.prompts')}
                  </NavLink>
                </li>
              </ul>
            </div>

            <QueueNav
              queues={queuesFor(user)}
              tasks={tasks}
              user={user}
              title={t('queues.section_admin')}
            />

            {/* Team Members Collapsible */}
            <div className="sidebar-section">
              <button
                type="button"
                className="sidebar-section-title sidebar-section-toggle"
                onClick={() => setMembersOpen(!membersOpen)}
                aria-expanded={membersOpen}
              >
                <span>{t('nav.by_member')}</span>
                <ChevronRight size={14} style={{ transform: membersOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }} />
              </button>
              {membersOpen && (
                <ul className="sidebar-nav">
                  {teamMembers.map((member) => (
                    <li key={member.id}>
                      <NavLink
                        to={`/member/${member.id}`}
                        className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
                      >
                        <Users size={18} className="sidebar-link-icon" />
                        {member.name}
                        <span className="sidebar-link-badge">
                          {formatNumber(getMemberTaskCount(member.id), language)}
                        </span>
                      </NavLink>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Financials & Admin Controls */}
            <div className="sidebar-section" style={{ marginTop: 'auto' }}>
              <div className="sidebar-section-title">{t('nav.administration')}</div>
              <ul className="sidebar-nav">
                <li>
                  <NavLink to="/payments" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
                    <CreditCard size={18} className="sidebar-link-icon" />
                    {t('nav.payments')}
                  </NavLink>
                </li>
                <li>
                  <NavLink to="/ledger" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
                    <CalendarRange size={18} className="sidebar-link-icon" />
                    {t('nav.ledger')}
                  </NavLink>
                </li>
                <li>
                  <NavLink to="/settings" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
                    <Settings size={18} className="sidebar-link-icon" />
                    {t('nav.settings')}
                  </NavLink>
                </li>
                <li>
                  <NavLink
                    to="/recycle-bin"
                    className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
                  >
                    <Trash2 size={18} className="sidebar-link-icon" />
                    {t('nav.recycle_bin')}
                    <span className="sidebar-link-badge">
                      {formatNumber(trashedTasks.length, language)}
                    </span>
                  </NavLink>
                </li>
              </ul>
            </div>
          </>
        ) : (
          /* Member Menu */
          <>
            <div className="sidebar-section">
              <div className="sidebar-section-title">{t('nav.my_work')}</div>
              <ul className="sidebar-nav">
                <li>
                  <NavLink to="/" end className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
                    <LayoutDashboard size={18} className="sidebar-link-icon" />
                    {t('nav.my_dashboard')}
                  </NavLink>
                </li>
                <li>
                  <NavLink to="/my-tasks" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
                    <ClipboardList size={18} className="sidebar-link-icon" />
                    {t('nav.my_tasks')}
                    <span className="sidebar-link-badge">
                      {formatNumber(
                        tasks.filter((task) => task.assigned_to === user?.id).length,
                        language
                      )}
                    </span>
                  </NavLink>
                </li>
                <li>
                  <NavLink to="/prompts" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
                    <MessageSquareText size={18} className="sidebar-link-icon" />
                    {t('nav.prompts')}
                  </NavLink>
                </li>
              </ul>
            </div>

            <QueueNav
              queues={queuesFor(user)}
              tasks={tasks}
              user={user}
              title={t('queues.section_member')}
            />

            <div className="sidebar-section" style={{ marginTop: 'auto' }}>
              <div className="sidebar-section-title">{t('nav.financials')}</div>
              <ul className="sidebar-nav">
                <li>
                  <NavLink to="/my-payments" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
                    <Wallet size={18} className="sidebar-link-icon" />
                    {t('nav.my_payments')}
                  </NavLink>
                </li>
              </ul>
            </div>
          </>
        )}

        {/* User Footer Profile */}
        <div className="sidebar-footer">
          <button
            type="button"
            className="sidebar-user"
            onClick={handleLogoutClick}
            title={t('nav.logout')}
          >
            <div className="sidebar-user-avatar">
              {user?.name?.charAt(0).toUpperCase() || '?'}
            </div>
            <div className="sidebar-user-info">
              <div className="sidebar-user-name">{user?.name}</div>
              <div className="sidebar-user-role">
                {user?.role === 'admin' ? t('members.admin_role') : t('members.member_role')}
              </div>
            </div>
            <LogOut size={16} style={{ opacity: 0.5 }} />
          </button>
        </div>
      </aside>

      {/* Only reached when there are unsaved drafts on this device. */}
      <ConfirmDialog
        open={showLogoutModal}
        title={t('common.logout_title')}
        tone="warning"
        confirmLabel={t('nav.logout')}
        onCancel={() => setShowLogoutModal(false)}
        onConfirm={() => void confirmLogout()}
      >
        <p className="confirm-copy">{t('common.logout_unsaved')}</p>
      </ConfirmDialog>
    </>
  );
}
