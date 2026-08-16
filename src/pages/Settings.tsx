import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  Download,
  Edit2,
  Eye,
  EyeOff,
  Loader2,
  Save,
  ShieldCheck,
  Trash2,
  UploadCloud,
  UserCheck,
  UserMinus,
  UserPlus,
} from 'lucide-react';
import { useAuthStore, useLanguageStore, useAppStore, useToastStore } from '../store';
import { exportBackup, importBackup, updateSettings } from '../api/tasks';
import {
  createUser,
  deleteUser,
  setCanReplyAnnouncements,
  setUserActive,
  updateUser,
} from '../api/users';
import ConfirmDialog, { type ConfirmTone } from '../components/shared/ConfirmDialog';
import AnnouncementEditor, {
  type AnnouncementDraft,
} from '../components/settings/AnnouncementEditor';
import {
  createAnnouncement,
  deleteAnnouncement,
  deleteAnnouncementReply,
  fetchAnnouncementReplies,
  fetchAnnouncements,
  updateAnnouncement,
} from '../api/announcements';
import type { Announcement, AnnouncementReply, User } from '../types';
import { formatNumber } from '../utils/dates';

type PendingConfirm = {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  tone: ConfirmTone;
  typeToConfirm?: string;
  run: () => Promise<void> | void;
};

export default function Settings() {
  const { t, language } = useLanguageStore();
  const { user: currentUser, updateUser: updateCurrentUser } = useAuthStore();
  const {
    members,
    settings,
    setSettings,
    announcements,
    setAnnouncements,
    announcementReplies,
    setAnnouncementReplies,
    addMember,
    updateMember,
    removeMember,
    tasks,
    setTasks,
    setTrashedTasks,
    setMembers,
  } = useAppStore();
  const { addToast } = useToastStore();

  const [rate, setRate] = useState(settings.usd_to_irr_rate);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  const [showUserForm, setShowUserForm] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [formName, setFormName] = useState('');
  const [formUsername, setFormUsername] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [formRole, setFormRole] = useState<'admin' | 'member'>('member');

  // Do not overwrite a rate somebody is mid-way through typing when another
  // admin's change arrives.
  const rateEditingRef = useRef(false);
  rateEditingRef.current = rate !== settings.usd_to_irr_rate;

  useEffect(() => {
    if (!rateEditingRef.current) setRate(settings.usd_to_irr_rate);
  }, [settings.usd_to_irr_rate]);

  const rateDirty = rate !== settings.usd_to_irr_rate;

  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } catch (error) {
      addToast(error instanceof Error ? error.message : t('common.unexpected_error'), 'error');
    } finally {
      setBusy(false);
    }
  };

  // ── Conversion rate ────────────────────────────────────────────────────────
  // Confirmed because it restates every IRR figure on every member's screen.
  // It used to save on one click with no warning at all.
  const requestSaveRate = () => {
    if (!Number.isFinite(rate) || rate <= 0) {
      addToast(t('settings.invalid_rate'), 'error');
      return;
    }
    setConfirm({
      title: t('settings.confirm_rate_title'),
      tone: 'warning',
      confirmLabel: t('payments.set_rate'),
      body: (
        <p className="confirm-copy">
          {t('settings.confirm_rate_body')
            .replace('{old}', formatNumber(settings.usd_to_irr_rate, language))
            .replace('{new}', formatNumber(rate, language))}
        </p>
      ),
      run: () =>
        run(async () => {
          const updated = await updateSettings(settings.id, { usd_to_irr_rate: rate });
          setSettings(updated);
          addToast(t('settings.rate_saved'), 'success');
        }),
    });
  };

  // ── Announcements ──────────────────────────────────────────────────────────
  // Publishing puts a message in front of somebody, so it confirms and shows
  // the exact text and audience first. Editing and taking one down cannot
  // mislead anybody, so neither asks.
  const memberName = (id: string | null) =>
    members.find((member) => member.id === id)?.name || t('announcement.unknown_member');

  const requestPublishAnnouncement = (draft: AnnouncementDraft) => {
    const message = draft.body.trim();
    if (!message || !currentUser) return;
    setConfirm({
      title: draft.targetUserId
        ? t('announcement.confirm_title_one').replace('{name}', memberName(draft.targetUserId))
        : t('announcement.confirm_title'),
      tone: draft.level === 'critical' ? 'danger' : 'warning',
      confirmLabel: t('common.confirm'),
      body: (
        <>
          <p className="confirm-copy">
            {draft.targetUserId
              ? t('announcement.confirm_body_one').replace(
                  '{name}',
                  memberName(draft.targetUserId)
                )
              : t('announcement.confirm_body').replace(
                  '{count}',
                  formatNumber(members.filter((member) => member.is_active).length, language)
                )}
          </p>
          <aside
            className={`announcement announcement-${draft.level} is-preview${
              draft.targetUserId ? ' is-personal' : ''
            }`}
            dir="auto"
          >
            {/* No `dir` on the paragraph: it would exclude the message from the
                banner's own auto resolution. See AnnouncementBanner. */}
            <p className="announcement-text">{message}</p>
          </aside>
        </>
      ),
      run: () =>
        run(async () => {
          await createAnnouncement({
            body: message,
            level: draft.level,
            targetUserId: draft.targetUserId,
            createdBy: currentUser.id,
          });
          setAnnouncements(await fetchAnnouncements());
          addToast(t('announcement.published'), 'success');
        }),
    });
  };

  const saveAnnouncement = (id: string, draft: AnnouncementDraft) =>
    run(async () => {
      await updateAnnouncement(id, {
        body: draft.body.trim(),
        level: draft.level,
        target_user_id: draft.targetUserId,
      });
      setAnnouncements(await fetchAnnouncements());
      addToast(t('announcement.updated'), 'success');
    });

  const removeAnnouncement = (announcement: Announcement) =>
    run(async () => {
      await deleteAnnouncement(announcement.id);
      // The database cascades its replies away; re-read both or the store keeps
      // answers to a notice that no longer exists.
      const [fresh, replies] = await Promise.all([
        fetchAnnouncements(),
        fetchAnnouncementReplies(),
      ]);
      setAnnouncements(fresh);
      setAnnouncementReplies(replies);
      addToast(t('announcement.cleared'), 'success');
    });

  const removeReply = (reply: AnnouncementReply) =>
    run(async () => {
      await deleteAnnouncementReply(reply.id);
      setAnnouncementReplies(await fetchAnnouncementReplies());
      addToast(t('announcement.reply_deleted'), 'success');
    });

  // Granting or withdrawing this is one click either way, so it does not ask
  // first — the confirmations are kept for what cannot be undone as easily.
  const toggleCanReply = (member: User) =>
    run(async () => {
      const next = !member.can_reply_announcements;
      const updated = await setCanReplyAnnouncements(member.id, next);
      updateMember(updated.id, updated);
      addToast(
        (next ? t('members.can_reply_granted') : t('members.can_reply_revoked')).replace(
          '{name}',
          member.name
        ),
        'success'
      );
    });

  // ── Backup ─────────────────────────────────────────────────────────────────
  const handleExport = () =>
    run(async () => {
      const json = await exportBackup();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `agnus-backup-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      addToast(t('settings.export_success'), 'success');
    });

  // Import overwrites every task, member and setting in the project. It used to
  // fire straight off the file picker, so it now asks for the phrase in full.
  const handleImportFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (loaded) => {
      const content = loaded.target?.result as string;
      input.value = '';
      setConfirm({
        title: t('settings.confirm_import_title'),
        tone: 'danger',
        confirmLabel: t('settings.import_action'),
        typeToConfirm: t('settings.import_phrase'),
        body: (
          <>
            <p className="confirm-copy">{t('settings.confirm_import_body')}</p>
            <p className="confirm-note">
              <AlertTriangle size={13} aria-hidden="true" />
              {t('settings.confirm_import_warning')}
            </p>
          </>
        ),
        run: () =>
          run(async () => {
            const result = await importBackup(content);
            setTasks(result.tasks);
            setTrashedTasks(result.trashedTasks);
            setMembers(result.users);
            setSettings(result.settings);
            addToast(t('settings.import_success'), 'success');
          }),
      });
    };
    reader.readAsText(file);
  };

  // ── Members ────────────────────────────────────────────────────────────────
  const resetUserForm = () => {
    setFormName('');
    setFormUsername('');
    setFormPassword('');
    setShowPassword(false);
    setFormRole('member');
    setEditingUser(null);
    setShowUserForm(false);
  };

  const openEditUser = (member: User) => {
    setEditingUser(member);
    setFormName(member.name);
    setFormUsername(member.username);
    setFormPassword('');
    setShowPassword(false);
    setFormRole(member.role);
    setShowUserForm(true);
  };

  const saveUser = () =>
    run(async () => {
      if (editingUser) {
        const updated = await updateUser(editingUser.id, {
          name: formName.trim(),
          username: formUsername.trim(),
          role: formRole,
          ...(formPassword ? { password: formPassword } : {}),
        });
        updateMember(updated.id, updated);
        if (updated.id === currentUser?.id) updateCurrentUser(updated);
        addToast(t('settings.member_updated').replace('{name}', updated.name), 'success');
      } else {
        const created = await createUser({
          name: formName.trim(),
          username: formUsername.trim(),
          password: formPassword,
          role: formRole,
        });
        addMember(created);
        addToast(t('settings.member_created').replace('{name}', created.name), 'success');
      }
      resetUserForm();
    });

  const requestSaveUser = () => {
    if (!formName.trim() || !formUsername.trim()) {
      addToast(t('settings.name_and_username_required'), 'error');
      return;
    }
    if (!/^[a-z0-9._-]{3,32}$/i.test(formUsername.trim())) {
      addToast(t('settings.invalid_username'), 'error');
      return;
    }
    if (!editingUser && !formPassword) {
      addToast(t('settings.password_required'), 'error');
      return;
    }
    if (formPassword && formPassword.trim().length < 8) {
      addToast(t('settings.password_too_short'), 'error');
      return;
    }

    // Granting admin hands over approvals, payments and the roster itself.
    // Every other edit to a member saves without interrupting.
    const promoting = formRole === 'admin' && editingUser?.role !== 'admin';
    if (!promoting) {
      void saveUser();
      return;
    }

    setConfirm({
      title: t('settings.confirm_promote_title'),
      tone: 'warning',
      confirmLabel: t('settings.confirm_promote_action'),
      body: (
        <>
          <p className="confirm-copy">
            {t('settings.confirm_promote_body').replace('{name}', formName.trim())}
          </p>
          <ul className="confirm-list">
            <li>{t('settings.promote_grant_tasks')}</li>
            <li>{t('settings.promote_grant_payments')}</li>
            <li>{t('settings.promote_grant_members')}</li>
          </ul>
        </>
      ),
      run: saveUser,
    });
  };

  const requestToggleActive = (member: User) => {
    const deactivating = member.is_active;
    setConfirm({
      title: deactivating
        ? t('settings.confirm_deactivate_title')
        : t('settings.confirm_activate_title'),
      tone: deactivating ? 'warning' : 'default',
      confirmLabel: deactivating ? t('settings.deactivate') : t('settings.activate'),
      body: (
        <p className="confirm-copy">
          {(deactivating
            ? t('settings.confirm_deactivate_body')
            : t('settings.confirm_activate_body')
          ).replace('{name}', member.name)}
        </p>
      ),
      run: () =>
        run(async () => {
          const updated = await setUserActive(member.id, !member.is_active);
          updateMember(updated.id, updated);
          addToast(
            deactivating ? t('settings.member_deactivated') : t('settings.member_activated'),
            'success'
          );
        }),
    });
  };

  const requestDeleteUser = (member: User) => {
    const taskCount = tasks.filter((task) => task.assigned_to === member.id).length;
    setConfirm({
      title: t('settings.confirm_remove_title'),
      tone: 'danger',
      confirmLabel: t('settings.remove_member'),
      typeToConfirm: member.username,
      body: (
        <>
          <p className="confirm-copy">
            {t('settings.confirm_remove_body').replace('{name}', member.name)}
          </p>
          <p className="confirm-note">
            <AlertTriangle size={13} aria-hidden="true" />
            {t('settings.confirm_remove_warning').replace(
              '{count}',
              formatNumber(taskCount, language)
            )}
          </p>
          <p className="confirm-note">{t('settings.prefer_deactivate')}</p>
        </>
      ),
      run: () =>
        run(async () => {
          await deleteUser(member.id);
          removeMember(member.id);
          addToast(t('settings.member_removed').replace('{name}', member.name), 'success');
        }),
    });
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('settings.title')}</h1>
          <p className="page-subtitle">{t('settings.subtitle')}</p>
        </div>
      </div>

      <AnnouncementEditor
        announcements={announcements}
        replies={announcementReplies}
        members={members}
        authorId={currentUser?.id || ''}
        busy={busy}
        onPublish={requestPublishAnnouncement}
        onUpdate={saveAnnouncement}
        onDelete={removeAnnouncement}
        onDeleteReply={removeReply}
      />

      <div className="settings-grid section-gap">
        <section className="card">
          <div className="card-header">
            <h2 className="card-title">{t('settings.conversion_rate')}</h2>
          </div>
          <p className="card-help">{t('settings.conversion_rate_help')}</p>
          <div className="settings-rate-row">
            <div className="form-group">
              <label className="form-label" htmlFor="settings-rate">
                {t('payments.conversion_rate')}
              </label>
              <div className="settings-rate-input">
                <span aria-hidden="true">1 USD =</span>
                <input
                  id="settings-rate"
                  type="number"
                  className="form-input input-mono"
                  value={rate}
                  onChange={(event) => {
                    // A NaN landing in state desyncs the controlled input;
                    // typing "1e" mid-number is a pause, not a change.
                    const parsed = Number(event.target.value);
                    if (Number.isFinite(parsed)) setRate(parsed);
                  }}
                  min={0}
                />
                <span aria-hidden="true">IRR</span>
              </div>
            </div>
            <button
              className="btn btn-primary"
              onClick={requestSaveRate}
              disabled={busy || !rateDirty}
            >
              {busy ? <Loader2 size={16} className="spin" /> : <Save size={16} />}
              {t('payments.set_rate')}
            </button>
          </div>
        </section>

        <section className="card">
          <div className="card-header">
            <h2 className="card-title">{t('settings.backup_title')}</h2>
          </div>
          <p className="card-help">{t('settings.backup_help')}</p>
          <div className="settings-backup-actions">
            <button className="btn btn-secondary btn-sm" onClick={handleExport} disabled={busy}>
              <Download size={14} />
              {t('settings.export_action')}
            </button>
            <button
              className="btn btn-secondary btn-sm btn-danger-outline"
              onClick={() => importInputRef.current?.click()}
              disabled={busy}
            >
              <UploadCloud size={14} />
              {t('settings.import_action')}
            </button>
            <input
              ref={importInputRef}
              type="file"
              accept=".json"
              onChange={handleImportFile}
              hidden
            />
          </div>
          <p className="settings-danger-note">
            <AlertTriangle size={13} aria-hidden="true" />
            {t('settings.import_danger_note')}
          </p>
        </section>
      </div>

      <section className="card section-gap">
        <div className="card-header">
          <h2 className="card-title">{t('settings.manage_users')}</h2>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => {
              resetUserForm();
              setShowUserForm(true);
            }}
          >
            <UserPlus size={16} />
            {t('members.create_user')}
          </button>
        </div>

        {showUserForm && (
          <div className="settings-user-form">
            <h3>{editingUser ? t('members.edit_user') : t('members.create_user')}</h3>
            <div className="settings-user-fields">
              <div className="form-group">
                <label className="form-label" htmlFor="member-name">
                  {t('members.name')}
                </label>
                <input
                  id="member-name"
                  className="form-input"
                  value={formName}
                  onChange={(event) => setFormName(event.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="member-username">
                  {t('members.username')}
                </label>
                <input
                  id="member-username"
                  className="form-input input-mono"
                  value={formUsername}
                  onChange={(event) => setFormUsername(event.target.value)}
                  autoComplete="off"
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="member-password">
                  {t('members.password')}
                </label>
                <div className="input-with-affix">
                  <input
                    id="member-password"
                    type={showPassword ? 'text' : 'password'}
                    className="form-input"
                    value={formPassword}
                    onChange={(event) => setFormPassword(event.target.value)}
                    placeholder={
                      editingUser ? t('settings.password_keep') : t('settings.password_set')
                    }
                    minLength={8}
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    className="btn btn-ghost btn-icon btn-sm input-affix"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={
                      showPassword ? t('settings.hide_password') : t('settings.show_password')
                    }
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="member-role">
                  {t('members.role')}
                </label>
                <select
                  id="member-role"
                  className="form-select"
                  value={formRole}
                  onChange={(event) => setFormRole(event.target.value as 'admin' | 'member')}
                  disabled={editingUser?.id === currentUser?.id}
                  title={
                    editingUser?.id === currentUser?.id
                      ? t('settings.cannot_change_own_role')
                      : undefined
                  }
                >
                  <option value="member">{t('members.member_role')}</option>
                  <option value="admin">{t('members.admin_role')}</option>
                </select>
              </div>
            </div>
            <div className="settings-user-form-actions">
              <button className="btn btn-secondary btn-sm" onClick={resetUserForm} disabled={busy}>
                {t('common.cancel')}
              </button>
              <button className="btn btn-primary btn-sm" onClick={requestSaveUser} disabled={busy}>
                {busy ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
                {t('common.save')}
              </button>
            </div>
          </div>
        )}

        <div className="data-table-wrapper is-flush">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">{t('members.name')}</th>
                <th scope="col">{t('members.username')}</th>
                <th scope="col">{t('members.role')}</th>
                <th scope="col">{t('members.total_tasks')}</th>
                <th scope="col">{t('settings.account_status')}</th>
                <th scope="col">{t('members.can_reply')}</th>
                <th scope="col">{t('tasks.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => {
                const taskCount = tasks.filter((task) => task.assigned_to === member.id).length;
                const isSelf = member.id === currentUser?.id;
                return (
                  <tr key={member.id} className={member.is_active ? '' : 'row-muted'}>
                    <td data-label={t('members.name')}>
                      <div className="member-cell">
                        <div className="member-avatar" aria-hidden="true">
                          {member.name.charAt(0).toUpperCase()}
                        </div>
                        {member.name}
                      </div>
                    </td>
                    <td data-label={t('members.username')}>
                      <span className="latin-text">@{member.username}</span>
                    </td>
                    <td data-label={t('members.role')}>
                      <span className={`status-badge role-${member.role}`}>
                        {member.role === 'admin' && <ShieldCheck size={12} aria-hidden="true" />}
                        {member.role === 'admin'
                          ? t('members.admin_role')
                          : t('members.member_role')}
                      </span>
                    </td>
                    <td data-label={t('members.total_tasks')}>
                      {formatNumber(taskCount, language)}
                    </td>
                    <td data-label={t('settings.account_status')}>
                      <span
                        className={`status-badge ${member.is_active ? 'is-active' : 'is-inactive'}`}
                      >
                        {member.is_active ? t('settings.active') : t('settings.inactive')}
                      </span>
                    </td>
                    <td data-label={t('members.can_reply')}>
                      {member.role === 'admin' ? (
                        <span className="status-badge is-active">{t('members.can_reply_always')}</span>
                      ) : (
                        <button
                          type="button"
                          role="switch"
                          aria-checked={Boolean(member.can_reply_announcements)}
                          className={`permission-toggle ${
                            member.can_reply_announcements ? 'is-on' : ''
                          }`}
                          onClick={() => toggleCanReply(member)}
                          disabled={busy || !member.is_active}
                          title={t('members.can_reply_help')}
                        >
                          {member.can_reply_announcements
                            ? t('members.can_reply_yes')
                            : t('members.can_reply_no')}
                        </button>
                      )}
                    </td>
                    <td data-label={t('tasks.actions')}>
                      <div className="row-actions">
                        <button className="btn btn-ghost btn-sm" onClick={() => openEditUser(member)}>
                          <Edit2 size={14} />
                          {t('common.edit')}
                        </button>
                        {/* Deactivating is the reversible option and comes
                            first; removal is kept but asks for the username. */}
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => requestToggleActive(member)}
                          disabled={isSelf}
                          title={isSelf ? t('settings.cannot_deactivate_self') : undefined}
                        >
                          {member.is_active ? <UserMinus size={14} /> : <UserCheck size={14} />}
                          {member.is_active ? t('settings.deactivate') : t('settings.activate')}
                        </button>
                        <button
                          className="btn btn-ghost btn-sm btn-ghost-danger"
                          onClick={() => requestDeleteUser(member)}
                          disabled={isSelf}
                          title={isSelf ? t('settings.cannot_remove_self') : undefined}
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
      </section>

      <ConfirmDialog
        open={Boolean(confirm)}
        title={confirm?.title || ''}
        tone={confirm?.tone}
        typeToConfirm={confirm?.typeToConfirm}
        confirmLabel={confirm?.confirmLabel || t('common.confirm')}
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          const pending = confirm;
          setConfirm(null);
          await pending?.run();
        }}
      >
        {confirm?.body}
      </ConfirmDialog>
    </div>
  );
}
