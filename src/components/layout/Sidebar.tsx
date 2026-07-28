import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Upload,
  ListTodo,
  Users,
  FolderKanban,
  CreditCard,
  Settings,
  LogOut,
  ClipboardList,
  Hammer,
  History,
  Wallet,
  Menu,
  X,
} from 'lucide-react';
import { useAuthStore, useLanguageStore, useAppStore } from '../../store';
import { logout } from '../../api/auth';

export default function Sidebar() {
  const { user } = useAuthStore();
  const { t } = useLanguageStore();
  const { sidebarOpen, setSidebarOpen, members, tasks } = useAppStore();
  const navigate = useNavigate();
  const isAdmin = user?.role === 'admin';

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const getStatusCount = (status: string) =>
    tasks.filter((t) => t.status === status).length;

  const getMemberTaskCount = (memberId: string) =>
    tasks.filter((t) => t.assigned_to === memberId).length;

  return (
    <>
      {/* Mobile menu button */}
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
        {/* Logo */}
        <div className="sidebar-logo">
          <div className="sidebar-logo-icon">A</div>
          <div>
            <span className="sidebar-logo-text">{t('app_name')}</span>
            <span className="sidebar-logo-sub">{t('app_subtitle')}</span>
          </div>
        </div>

        {/* Admin Navigation */}
        {isAdmin ? (
          <>
            <div className="sidebar-section">
              <ul className="sidebar-nav">
                <li>
                  <NavLink to="/" end className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
                    <LayoutDashboard size={20} className="sidebar-link-icon" />
                    {t('nav.dashboard')}
                  </NavLink>
                </li>
                <li>
                  <NavLink to="/upload" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
                    <Upload size={20} className="sidebar-link-icon" />
                    {t('nav.upload_tasks')}
                  </NavLink>
                </li>
                <li>
                  <NavLink to="/tasks" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
                    <ListTodo size={20} className="sidebar-link-icon" />
                    {t('nav.all_tasks')}
                    <span className="sidebar-link-badge">{tasks.length}</span>
                  </NavLink>
                </li>
              </ul>
            </div>

            {/* By Member */}
            <div className="sidebar-section">
              <div className="sidebar-section-title">{t('nav.by_member')}</div>
              <ul className="sidebar-nav">
                {members.map((member) => (
                  <li key={member.id}>
                    <NavLink
                      to={`/member/${member.id}`}
                      className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
                    >
                      <Users size={20} className="sidebar-link-icon" />
                      {member.name}
                      <span className="sidebar-link-badge">{getMemberTaskCount(member.id)}</span>
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>

            {/* By Status */}
            <div className="sidebar-section">
              <div className="sidebar-section-title">{t('nav.by_status')}</div>
              <ul className="sidebar-nav">
                {[
                  { status: 'assigned', icon: ClipboardList },
                  { status: 'working', icon: Hammer },
                  { status: 'swf', icon: FolderKanban },
                  { status: 'swof', icon: FolderKanban },
                  { status: 'member_discarded', icon: FolderKanban },
                  { status: 'on_hold', icon: FolderKanban },
                  { status: 'in_studio', icon: FolderKanban },
                  { status: 'in_review', icon: FolderKanban },
                  { status: 'approved', icon: FolderKanban },
                  { status: 'sent_back', icon: FolderKanban },
                  { status: 'admin_discarded', icon: FolderKanban },
                ].map(({ status, icon: Icon }) => {
                  const count = getStatusCount(status);
                  if (count === 0 && !['assigned', 'working', 'swf', 'swof', 'approved'].includes(status)) return null;
                  return (
                    <li key={status}>
                      <NavLink
                        to={`/status/${status}`}
                        className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
                      >
                        <Icon size={20} className="sidebar-link-icon" />
                        {t(`status.${status}`)}
                        <span className="sidebar-link-badge">{count}</span>
                      </NavLink>
                    </li>
                  );
                })}
              </ul>
            </div>

            {/* Bottom */}
            <div className="sidebar-section">
              <ul className="sidebar-nav">
                <li>
                  <NavLink to="/payments" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
                    <CreditCard size={20} className="sidebar-link-icon" />
                    {t('nav.payments')}
                  </NavLink>
                </li>
                <li>
                  <NavLink to="/settings" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
                    <Settings size={20} className="sidebar-link-icon" />
                    {t('nav.settings')}
                  </NavLink>
                </li>
              </ul>
            </div>
          </>
        ) : (
          /* Member Navigation */
          <>
            <div className="sidebar-section">
              <ul className="sidebar-nav">
                <li>
                  <NavLink to="/" end className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
                    <LayoutDashboard size={20} className="sidebar-link-icon" />
                    {t('nav.my_dashboard')}
                  </NavLink>
                </li>
                <li>
                  <NavLink to="/my-tasks" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
                    <ClipboardList size={20} className="sidebar-link-icon" />
                    {t('nav.my_tasks')}
                    <span className="sidebar-link-badge">
                      {tasks.filter((t) => t.assigned_to === user?.id && t.status === 'assigned').length}
                    </span>
                  </NavLink>
                </li>
                <li>
                  <NavLink to="/working" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
                    <Hammer size={20} className="sidebar-link-icon" />
                    {t('nav.working')}
                    <span className="sidebar-link-badge">
                      {tasks.filter((t) => t.assigned_to === user?.id && t.status === 'working').length}
                    </span>
                  </NavLink>
                </li>
              </ul>
            </div>

            <div className="sidebar-section">
              <div className="sidebar-section-title">{t('nav.my_history')}</div>
              <ul className="sidebar-nav">
                {(['swf', 'swof', 'member_discarded', 'in_studio', 'in_review', 'approved', 'sent_back', 'admin_discarded'] as const).map(
                  (status) => {
                    const count = tasks.filter(
                      (t) => t.assigned_to === user?.id && t.status === status
                    ).length;
                    return (
                      <li key={status}>
                        <NavLink
                          to={`/my-history/${status}`}
                          className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
                        >
                          <History size={20} className="sidebar-link-icon" />
                          {t(`status.${status}`)}
                          <span className="sidebar-link-badge">{count}</span>
                        </NavLink>
                      </li>
                    );
                  }
                )}
              </ul>
            </div>

            <div className="sidebar-section">
              <ul className="sidebar-nav">
                <li>
                  <NavLink to="/my-payments" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
                    <Wallet size={20} className="sidebar-link-icon" />
                    {t('nav.my_payments')}
                  </NavLink>
                </li>
              </ul>
            </div>
          </>
        )}

        {/* User Footer */}
        <div className="sidebar-footer">
          <div className="sidebar-user" onClick={handleLogout} title={t('nav.logout')}>
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
    </>
  );
}
