import { useState } from 'react';
import { UserPlus, Save, Loader2, Trash2, Edit2, AlertCircle, Eye, EyeOff } from 'lucide-react';
import { useLanguageStore, useAppStore, useToastStore } from '../store';
import { createUser, updateUser as apiUpdateUser, deleteUser as apiDeleteUser, updateSettings } from '../api/tasks';
import type { User } from '../types';

export default function Settings() {
  const { t } = useLanguageStore();
  const { members, settings, setSettings, addMember, updateMember, removeMember, tasks } = useAppStore();
  const { addToast } = useToastStore();

  // Conversion rate
  const [rate, setRate] = useState(settings.usd_to_irr_rate);
  const [savingRate, setSavingRate] = useState(false);

  // User form modal
  const [showUserForm, setShowUserForm] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [formName, setFormName] = useState('');
  const [formUsername, setFormUsername] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [formRole, setFormRole] = useState<'admin' | 'member'>('member');
  const [savingUser, setSavingUser] = useState(false);

  // Delete confirm modal
  const [deletingUser, setDeletingUser] = useState<User | null>(null);
  const [deleting, setDeleting] = useState(false);

  const handleSaveRate = async () => {
    setSavingRate(true);
    try {
      const updated = await updateSettings(settings.id, { usd_to_irr_rate: rate });
      setSettings(updated);
      addToast('Conversion rate updated', 'success');
    } catch {
      addToast('Failed to update rate', 'error');
    } finally {
      setSavingRate(false);
    }
  };

  const resetUserForm = () => {
    setFormName('');
    setFormUsername('');
    setFormPassword('');
    setShowPassword(false);
    setFormRole('member');
    setEditingUser(null);
    setShowUserForm(false);
  };

  const handleEditUser = (user: User) => {
    setEditingUser(user);
    setFormName(user.name);
    setFormUsername(user.username);
    setFormPassword('');
    setShowPassword(false);
    setFormRole(user.role as 'admin' | 'member');
    setShowUserForm(true);
  };

  const handleSaveUser = async () => {
    if (savingUser) return;
    if (!formName.trim() || !formUsername.trim()) return;
    setSavingUser(true);
    try {
      if (editingUser) {
        // Update existing user
        const data: Record<string, string> = { name: formName, role: formRole };
        if (formPassword) {
          data.password = formPassword;
          data.passwordConfirm = formPassword;
        }
        const updated = await apiUpdateUser(editingUser.id, data);
        updateMember(editingUser.id, updated);
        addToast(`Member "${formName}" updated successfully`, 'success');
      } else {
        // Create new user
        if (!formPassword) {
          addToast('Password is required for new users', 'error');
          setSavingUser(false);
          return;
        }
        const created = await createUser({
          name: formName,
          username: formUsername,
          password: formPassword,
          passwordConfirm: formPassword,
          role: formRole,
        });
        addMember(created);
        addToast(`Member "${formName}" created successfully`, 'success');
      }
      resetUserForm();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to save user';
      addToast(message, 'error');
    } finally {
      setSavingUser(false);
    }
  };

  const handleDeleteUserConfirm = async () => {
    if (!deletingUser || deleting) return;
    setDeleting(true);
    try {
      await apiDeleteUser(deletingUser.id);
      removeMember(deletingUser.id);
      addToast(`Member "${deletingUser.name}" was removed`, 'success');
      setDeletingUser(null);
    } catch {
      addToast('Failed to remove member', 'error');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('settings.title')}</h1>
          <p className="page-subtitle">Manage team permissions, currency rates, and configuration</p>
        </div>
      </div>

      {/* Conversion Rate */}
      <div className="card" style={{ maxWidth: '520px', marginBottom: 'var(--space-6)' }}>
        <div className="card-header">
          <h3 className="card-title">{t('settings.conversion_rate')}</h3>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'end' }}>
          <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
            <label className="form-label">{t('payments.conversion_rate')}</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>1 USD =</span>
              <input
                type="number"
                className="form-input input-mono"
                value={rate}
                onChange={(e) => setRate(Number(e.target.value))}
                min={0}
              />
              <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>IRR</span>
            </div>
          </div>
          <button className="btn btn-primary" onClick={handleSaveRate} disabled={savingRate}>
            {savingRate ? <Loader2 size={16} className="spin" /> : <Save size={16} />}
            {t('payments.set_rate')}
          </button>
        </div>
      </div>

      {/* User Management */}
      <div className="card">
        <div className="card-header">
          <h3 className="card-title">{t('settings.manage_users')}</h3>
          <button className="btn btn-primary btn-sm" onClick={() => { resetUserForm(); setShowUserForm(true); }}>
            <UserPlus size={16} />
            {t('members.create_user')}
          </button>
        </div>

        {/* User Form Modal / Drawer */}
        {showUserForm && (
          <div style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-lg)',
            padding: 'var(--space-5)',
            marginBottom: 'var(--space-5)',
          }}>
            <h4 style={{ marginBottom: 'var(--space-4)', fontSize: 'var(--text-base)', fontWeight: 'var(--weight-bold)' }}>
              {editingUser ? t('members.edit_user') : t('members.create_user')}
            </h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--space-3)' }}>
              <div className="form-group">
                <label className="form-label">{t('members.name')}</label>
                <input
                  className="form-input"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g. Sina"
                />
              </div>
              <div className="form-group">
                <label className="form-label">{t('members.username')}</label>
                <input
                  className="form-input input-mono"
                  value={formUsername}
                  onChange={(e) => setFormUsername(e.target.value)}
                  placeholder="e.g. sina"
                  disabled={!!editingUser}
                />
              </div>
              <div className="form-group">
                <label className="form-label">{t('members.password')}</label>
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    className="form-input"
                    value={formPassword}
                    onChange={(e) => setFormPassword(e.target.value)}
                    placeholder={editingUser ? 'Leave empty to keep current' : 'Set password'}
                    style={{ paddingInlineEnd: '40px' }}
                  />
                  <button
                    type="button"
                    className="btn btn-ghost btn-icon btn-sm"
                    onClick={() => setShowPassword(!showPassword)}
                    style={{
                      position: 'absolute',
                      insetInlineEnd: '8px',
                      color: 'var(--color-text-secondary)',
                    }}
                    title={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">{t('members.role')}</label>
                <select
                  className="form-select"
                  value={formRole}
                  onChange={(e) => setFormRole(e.target.value as 'admin' | 'member')}
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end', marginTop: 'var(--space-3)' }}>
              <button className="btn btn-secondary btn-sm" onClick={resetUserForm}>
                {t('common.cancel')}
              </button>
              <button className="btn btn-primary btn-sm" onClick={handleSaveUser} disabled={savingUser}>
                {savingUser ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
                {t('common.save')}
              </button>
            </div>
          </div>
        )}

        {/* Members Table */}
        <div className="data-table-wrapper" style={{ border: 'none' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('members.name')}</th>
                <th>{t('members.username')}</th>
                <th>{t('members.role')}</th>
                <th>{t('members.total_tasks')}</th>
                <th>{t('tasks.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => {
                const taskCount = tasks.filter((t) => t.assigned_to === member.id).length;
                return (
                  <tr key={member.id}>
                    <td>
                      <div className="member-cell">
                        <div className="member-avatar">{member.name.charAt(0).toUpperCase()}</div>
                        {member.name}
                      </div>
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>
                      @{member.username}
                    </td>
                    <td>
                      <span
                        className="status-badge"
                        style={{
                          color: member.role === 'admin' ? 'var(--color-purple)' : 'var(--color-primary)',
                          background: member.role === 'admin' ? 'var(--color-purple-bg)' : 'var(--color-primary-50)',
                        }}
                      >
                        {member.role === 'admin' ? 'Admin' : 'Member'}
                      </span>
                    </td>
                    <td>{taskCount} tasks</td>
                    <td>
                      <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => handleEditUser(member)}>
                          <Edit2 size={14} />
                          {t('common.edit')}
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          style={{ color: 'var(--color-danger)' }}
                          onClick={() => setDeletingUser(member)}
                        >
                          <Trash2 size={14} />
                          {t('common.delete')}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Delete User Confirmation Modal */}
      {deletingUser && (
        <>
          <div className="modal-backdrop" onClick={() => setDeletingUser(null)} />
          <div className="modal">
            <div className="modal-header">
              <h3 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--color-danger)' }}>
                <AlertCircle size={20} />
                Remove Team Member?
              </h3>
              <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setDeletingUser(null)}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-primary)' }}>
                Are you sure you want to remove <strong>{deletingUser.name}</strong> (@{deletingUser.username}) from the team?
              </p>
              <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', marginTop: 'var(--space-2)' }}>
                This action cannot be undone. Any tasks assigned to this member will remain in the database and can be reassigned.
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setDeletingUser(null)}>
                {t('common.cancel')}
              </button>
              <button className="btn btn-danger" onClick={handleDeleteUserConfirm} disabled={deleting}>
                {deleting ? <Loader2 size={16} className="spin" /> : <Trash2 size={16} />}
                Remove Member
              </button>
            </div>
          </div>
        </>
      )}

      <style>{`
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
