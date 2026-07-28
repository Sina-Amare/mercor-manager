import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Upload,
  ListTodo,
  Users,
  CreditCard,
  Settings,
  LogOut,
  ClipboardList,
  Hammer,
  Wallet,
  Menu,
  X,
  ChevronRight,
  AlertCircle,
} from 'lucide-react';
import { useAuthStore, useLanguageStore, useAppStore } from '../../store';
import { logout } from '../../api/auth';
import { useState } from 'react';

export default function Sidebar() {
  const { user } = useAuthStore();
  const { t } = useLanguageStore();
  const { sidebarOpen, setSidebarOpen, members, tasks } = useAppStore();
  const navigate = useNavigate();
  const isAdmin = user?.role === 'admin';

  const [membersOpen, setMembersOpen] = useState(true);
  const [showLogoutModal, setShowLogoutModal] = useState(false);

  const confirmLogout = () => {
    logout();
    setShowLogoutModal(false);
    navigate('/login');
  };

  const getMemberTaskCount = (memberId: string) =>
    tasks.filter((t) => t.assigned_to === memberId).length;

  return (
    <>
      <button
        className="sidebar-mobile-toggle btn btn-icon btn-ghost"
        onClick={() => setSidebarOpen(!sidebarOpen)}
        style={{
          position: 'fixed',
          top: '14px',
          insetInlineStart: '12px',
          zIndex: 110,
          display: 'none',
        }}
      >
        {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
      </button>

      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
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
              <div className="sidebar-section-title">Main Workspace</div>
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
                    <span className="sidebar-link-badge">{tasks.length}</span>
                  </NavLink>
                </li>
              </ul>
            </div>

            {/* Team Members Collapsible */}
            <div className="sidebar-section">
              <div
                className="sidebar-section-title"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
                onClick={() => setMembersOpen(!membersOpen)}
              >
                <span>{t('nav.by_member')}</span>
                <ChevronRight size={14} style={{ transform: membersOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }} />
              </div>
              {membersOpen && (
                <ul className="sidebar-nav">
                  {members.map((member) => (
                    <li key={member.id}>
                      <NavLink
                        to={`/member/${member.id}`}
                        className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
                      >
                        <Users size={18} className="sidebar-link-icon" />
                        {member.name}
                        <span className="sidebar-link-badge">{getMemberTaskCount(member.id)}</span>
                      </NavLink>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Financials & Admin Controls */}
            <div className="sidebar-section" style={{ marginTop: 'auto' }}>
              <div className="sidebar-section-title">Administration</div>
              <ul className="sidebar-nav">
                <li>
                  <NavLink to="/payments" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
                    <CreditCard size={18} className="sidebar-link-icon" />
                    {t('nav.payments')}
                  </NavLink>
                </li>
                <li>
                  <NavLink to="/settings" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
                    <Settings size={18} className="sidebar-link-icon" />
                    {t('nav.settings')}
                  </NavLink>
                </li>
              </ul>
            </div>
          </>
        ) : (
          /* Member Menu */
          <>
            <div className="sidebar-section">
              <div className="sidebar-section-title">My Work</div>
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
                      {tasks.filter((t) => t.assigned_to === user?.id && t.status === 'assigned').length}
                    </span>
                  </NavLink>
                </li>
                <li>
                  <NavLink to="/working" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
                    <Hammer size={18} className="sidebar-link-icon" />
                    {t('nav.working')}
                    <span className="sidebar-link-badge">
                      {tasks.filter((t) => t.assigned_to === user?.id && t.status === 'working').length}
                    </span>
                  </NavLink>
                </li>
              </ul>
            </div>

            <div className="sidebar-section" style={{ marginTop: 'auto' }}>
              <div className="sidebar-section-title">Financials</div>
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
          <div className="sidebar-user" onClick={() => setShowLogoutModal(true)} title={t('nav.logout')}>
            <div className="sidebar-user-avatar">
              {user?.name?.charAt(0).toUpperCase() || '?'}
            </div>
            <div className="sidebar-user-info">
              <div className="sidebar-user-name">{user?.name}</div>
              <div className="sidebar-user-role">
                {user?.role === 'admin' ? 'Admin' : 'Member'}
              </div>
            </div>
            <LogOut size={16} style={{ opacity: 0.5 }} />
          </div>
        </div>
      </aside>

      {/* Logout Confirmation Modal */}
      {showLogoutModal && (
        <>
          <div className="modal-backdrop" onClick={() => setShowLogoutModal(false)} />
          <div className="modal">
            <div className="modal-header">
              <h3 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <AlertCircle size={20} style={{ color: 'var(--color-primary)' }} />
                Log Out of {t('app_name')}?
              </h3>
              <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setShowLogoutModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-primary)' }}>
                Are you sure you want to log out of your session as <strong>{user?.name}</strong> (@{user?.username})?
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowLogoutModal(false)}>
                {t('common.cancel')}
              </button>
              <button className="btn btn-primary" onClick={confirmLogout} style={{ background: 'var(--color-danger)', borderColor: 'var(--color-danger)' }}>
                <LogOut size={16} />
                Log Out
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
