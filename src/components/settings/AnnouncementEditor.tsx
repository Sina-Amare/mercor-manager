import { useState } from 'react';
import {
  AlertTriangle,
  Loader2,
  Megaphone,
  MessageSquare,
  Pencil,
  Send,
  Trash2,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import type { Announcement, AnnouncementLevel, AnnouncementReply, User } from '../../types';
import { useLanguageStore } from '../../store';
import DateDisplay from '../shared/DateDisplay';
import { formatNumber } from '../../utils/dates';

const LEVELS: readonly AnnouncementLevel[] = ['info', 'warning', 'critical'];

/** null is the whole team; a value is the one member who sees it. */
export interface AnnouncementDraft {
  body: string;
  level: AnnouncementLevel;
  targetUserId: string | null;
}

interface Props {
  announcements: Announcement[];
  replies: AnnouncementReply[];
  members: User[];
  /** The admin writing. They are not offered as a recipient of their own notice. */
  authorId: string;
  busy: boolean;
  onPublish: (draft: AnnouncementDraft) => void;
  onUpdate: (id: string, draft: AnnouncementDraft) => void;
  onDelete: (announcement: Announcement) => void;
  onDeleteReply: (reply: AnnouncementReply) => void;
}

const EMPTY: AnnouncementDraft = { body: '', level: 'info', targetUserId: null };

/**
 * Writes and manages the notices.
 *
 * The preview is the point: it renders with exactly the component, direction
 * detection and typography members will get, so a Persian notice can be checked
 * for right-to-left rendering before anyone else sees it — rather than
 * publishing and then asking somebody whether it looks right.
 *
 * The audience is chosen in the same place as the words, and the publish button
 * names the recipient, so "send to everyone" and "send to Nasim" cannot be
 * confused for one another at the moment of pressing it.
 */
export default function AnnouncementEditor({
  announcements,
  replies,
  members,
  authorId,
  busy,
  onPublish,
  onUpdate,
  onDelete,
  onDeleteReply,
}: Props) {
  const { t, language } = useLanguageStore();
  const [draft, setDraft] = useState<AnnouncementDraft>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [openReplies, setOpenReplies] = useState<string | null>(null);

  const set = (patch: Partial<AnnouncementDraft>) => setDraft((current) => ({ ...current, ...patch }));

  const recipients = members.filter((member) => member.is_active && member.id !== authorId);
  const nameFor = (id: string | null) =>
    members.find((member) => member.id === id)?.name || t('announcement.unknown_member');

  const Icon = draft.level === 'info' ? Megaphone : AlertTriangle;
  const ready = Boolean(draft.body.trim()) && !busy;

  const startEditing = (announcement: Announcement) => {
    setEditingId(announcement.id);
    setDraft({
      body: announcement.body,
      level: announcement.level,
      targetUserId: announcement.target_user_id,
    });
  };

  const cancelEditing = () => {
    setEditingId(null);
    setDraft(EMPTY);
  };

  const submit = () => {
    if (!ready) return;
    if (editingId) onUpdate(editingId, draft);
    else onPublish(draft);
    cancelEditing();
  };

  return (
    <section className="card">
      <div className="card-header">
        <h2 className="card-title">{t('announcement.title')}</h2>
        {announcements.length > 0 && (
          <span className="status-badge announcement-live">
            {t('announcement.live_count').replace('{count}', String(announcements.length))}
          </span>
        )}
      </div>
      <p className="card-help">{t('announcement.help')}</p>

      <div className="form-group">
        <label className="form-label" htmlFor="announcement-audience">
          {t('announcement.audience')}
        </label>
        <select
          id="announcement-audience"
          className="form-select"
          value={draft.targetUserId ?? ''}
          onChange={(event) => set({ targetUserId: event.target.value || null })}
        >
          <option value="">{t('announcement.audience_everyone')}</option>
          {recipients.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
        </select>
        <small className="form-hint">
          {draft.targetUserId
            ? t('announcement.audience_one_help').replace('{name}', nameFor(draft.targetUserId))
            : t('announcement.audience_everyone_help')}
        </small>
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="announcement-text">
          {t('announcement.message')}
        </label>
        <textarea
          id="announcement-text"
          className="form-textarea announcement-input"
          value={draft.body}
          onChange={(event) => set({ body: event.target.value })}
          placeholder={t('announcement.placeholder')}
          rows={4}
          maxLength={600}
          // Written in whatever language suits; the field follows the text.
          dir="auto"
        />
        <small className="announcement-count">{draft.body.length} / 600</small>
      </div>

      <div className="form-group">
        <span className="form-label">{t('announcement.level')}</span>
        <div className="announcement-levels" role="radiogroup" aria-label={t('announcement.level')}>
          {LEVELS.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={draft.level === option}
              className={`announcement-level-option is-${option} ${
                draft.level === option ? 'active' : ''
              }`}
              onClick={() => set({ level: option })}
            >
              {t(`announcement.level_${option}`)}
            </button>
          ))}
        </div>
      </div>

      {draft.body.trim() && (
        <div className="announcement-preview">
          <span className="announcement-preview-label">
            {draft.targetUserId
              ? t('announcement.preview_one').replace('{name}', nameFor(draft.targetUserId))
              : t('announcement.preview')}
          </span>
          <aside
            className={`announcement announcement-${draft.level} is-preview${
              draft.targetUserId ? ' is-personal' : ''
            }`}
            dir="auto"
          >
            <Icon className="announcement-icon" size={20} aria-hidden="true" />
            <div className="announcement-content">
              {draft.targetUserId && (
                // Explicit direction, and no `dir` on the message paragraph —
                // see AnnouncementBanner. The preview is only worth having if
                // it resolves direction exactly the way the real banner does.
                <span className="announcement-tag" dir={language === 'fa' ? 'rtl' : 'ltr'}>
                  <UserRound size={12} aria-hidden="true" />
                  {t('announcement.for_you')}
                </span>
              )}
              <p className="announcement-text">{draft.body}</p>
            </div>
          </aside>
        </div>
      )}

      <div className="announcement-actions">
        {editingId && (
          <button className="btn btn-secondary btn-sm" onClick={cancelEditing} disabled={busy}>
            <X size={14} />
            {t('common.cancel')}
          </button>
        )}
        <button className="btn btn-primary" onClick={submit} disabled={!ready}>
          {busy ? <Loader2 size={15} className="spin" /> : <Send size={15} />}
          {editingId
            ? t('announcement.update')
            : draft.targetUserId
              ? t('announcement.publish_one').replace('{name}', nameFor(draft.targetUserId))
              : t('announcement.publish')}
        </button>
      </div>

      {announcements.length > 0 && (
        <div className="announcement-list">
          <h3 className="announcement-list-title">{t('announcement.live_title')}</h3>
          <ul className="announcement-list-items">
            {announcements.map((announcement) => {
              const answers = replies
                .filter((reply) => reply.announcement_id === announcement.id)
                .sort((a, b) => a.created.localeCompare(b.created));
              const showing = openReplies === announcement.id;

              return (
                <li key={announcement.id} className="announcement-row-group">
                  <div className="announcement-row">
                <span
                  className={`announcement-row-audience ${
                    announcement.target_user_id ? 'is-personal' : ''
                  }`}
                >
                  {announcement.target_user_id ? (
                    <>
                      <UserRound size={13} aria-hidden="true" />
                      {nameFor(announcement.target_user_id)}
                    </>
                  ) : (
                    <>
                      <Users size={13} aria-hidden="true" />
                      {t('announcement.audience_everyone')}
                    </>
                  )}
                </span>
                <p className="announcement-row-body" dir="auto">
                  {announcement.body}
                </p>
                <span className={`announcement-row-level is-${announcement.level}`}>
                  {t(`announcement.level_${announcement.level}`)}
                </span>
                <span className="announcement-row-date">
                  <DateDisplay date={announcement.created} />
                </span>
                <span className="announcement-row-actions">
                  {answers.length > 0 && (
                    <button
                      className={`btn btn-ghost btn-sm announcement-row-replies ${
                        showing ? 'is-open' : ''
                      }`}
                      onClick={() => setOpenReplies(showing ? null : announcement.id)}
                      aria-expanded={showing}
                      title={t('announcement.replies_title')}
                    >
                      <MessageSquare size={14} />
                      {formatNumber(answers.length, language)}
                    </button>
                  )}
                  <button
                    className="btn btn-ghost btn-icon btn-sm"
                    onClick={() => startEditing(announcement)}
                    disabled={busy}
                    aria-label={t('announcement.edit')}
                    title={t('announcement.edit')}
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    className="btn btn-ghost btn-icon btn-sm btn-ghost-danger"
                    onClick={() => onDelete(announcement)}
                    disabled={busy}
                    aria-label={t('announcement.clear')}
                    title={t('announcement.clear')}
                  >
                    <Trash2 size={14} />
                  </button>
                </span>
                  </div>

                  {/* answers.length guards the panel as well as the button:
                      deleting the last answer would otherwise leave an empty
                      open panel with nothing left to close it. */}
                  {showing && answers.length > 0 && (
                    <ul className="announcement-answers">
                      {answers.map((reply) => (
                        <li key={reply.id} className="announcement-answer">
                          <span className="announcement-answer-author">
                            <UserRound size={13} aria-hidden="true" />
                            {nameFor(reply.author_id)}
                          </span>
                          <p className="announcement-answer-body" dir="auto">
                            {reply.body}
                          </p>
                          <span className="announcement-answer-date">
                            <DateDisplay date={reply.created} />
                          </span>
                          <button
                            className="btn btn-ghost btn-icon btn-sm btn-ghost-danger"
                            onClick={() => onDeleteReply(reply)}
                            disabled={busy}
                            aria-label={t('announcement.delete_reply')}
                            title={t('announcement.delete_reply')}
                          >
                            <Trash2 size={13} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
