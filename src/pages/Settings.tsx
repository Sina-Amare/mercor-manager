import { useState } from 'react';
import { UserPlus, Save, Loader2 } from 'lucide-react';
import { useLanguageStore, useAppStore, useToastStore } from '../store';
import { createUser, updateUser as apiUpdateUser, updateSettings } from '../api/tasks';
import type { User } from '../types';

export default function Settings() {
  const { t } = useLanguageStore();
  const { members, settings, setSettings, addMember, updateMember } = useAppStore();
  const { addToast } = useToastStore();

  // Conversion rate
  const [rate, setRate] = useState(settings.usd_to_irr_rate);
  const [savingRate, setSavingRate] = useState(false);

  // New user form
  const [showUserForm, setShowUserForm] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [formName, setFormName] = useState('');
  const [formUsername, setFormUsername] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [formRole, setFormRole] = useState<'admin' | 'member'>('member');
  const [savingUser, setSavingUser] = useState(false);

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
    setFormRole('member');
    setEditingUser(null);
    setShowUserForm(false);
  };

  const handleEditUser = (user: User) => {
    setEditingUser(user);
    setFormName(user.name);
    setFormUsername(user.username);
    setFormPassword('');
    setFormRole(user.role as 'admin' | 'member');
    setShowUserForm(true);
  };

  const handleSaveUser = async () => {
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
        addToast('User updated', 'success');
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
        addToast('User created', 'success');
      }
      resetUserForm();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to save user';
      addToast(message, 'error');
    } finally {
      setSavingUser(false);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('settings.title')}</h1>
        </div>
      </div>

      {/* Conversion Rate */}
      <div className="card" style={{ maxWidth: '480px', marginBottom: 'var(--space-6)' }}>
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

        {/* User Form (Create/Edit) */}
        {showUserForm && (
          <div style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-4)',
            marginBottom: 'var(--space-4)',
          }}>
            <h4 style={{ marginBottom: 'var(--space-3)', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)' }}>
              {editingUser ? t('members.edit_user') : t('members.create_user')}
            </h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
              <div className="form-group">
                <label className="form-label">{t('members.name')}</label>
                <input
                  className="form-input"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="John Doe"
                />
              </div>
              <div className="form-group">
                <label className="form-label">{t('members.username')}</label>
                <input
                  className="form-input"
                  value={formUsername}
                  onChange={(e) => setFormUsername(e.target.value)}
                  placeholder="johndoe"
                  disabled={!!editingUser}
                />
              </div>
              <div className="form-group">
                <label className="form-label">{t('members.password')}</label>
                <input
                  type="password"
                  className="form-input"
                  value={formPassword}
                  onChange={(e) => setFormPassword(e.target.value)}
                  placeholder={editingUser ? 'Leave empty to keep current' : 'Set password'}
                />
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
            <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
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

        {/* Members List */}
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
                const taskCount = useAppStore.getState().tasks.filter((t) => t.assigned_to === member.id).length;
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
                    <td>{taskCount}</td>
                    <td>
                      <button className="btn btn-ghost btn-sm" onClick={() => handleEditUser(member)}>
                        {t('common.edit')}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <style>{`
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
