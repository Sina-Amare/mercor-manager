import { useState } from 'react';
import { Loader2, Send, Trash2 } from 'lucide-react';
import { useAppStore, useAuthStore, useLanguageStore, useToastStore } from '../../store';
import {
  createAnnouncementReply,
  deleteAnnouncementReply,
  fetchAnnouncementReplies,
} from '../../api/announcements';
import DateDisplay from './DateDisplay';
import type { Announcement } from '../../types';

interface Props {
  announcement: Announcement;
}

/**
 * Answering an announcement, for the members an admin has allowed to.
 *
 * Only what this person wrote is ever shown here. Their answer goes to whoever
 * posted the notice; a colleague replying to the same team-wide announcement is
 * not part of this conversation and their words never reach this browser — the
 * policy sees to that, not this component.
 *
 * Withdrawing is offered because being able to say something and not being able
 * to take it back is a worse deal than staying quiet.
 */
export default function AnnouncementReplyBox({ announcement }: Props) {
  const { user } = useAuthStore();
  const { announcementReplies, setAnnouncementReplies } = useAppStore();
  const { t, language } = useLanguageStore();
  const { addToast } = useToastStore();

  // These are interface controls, in the interface's language, so they follow
  // the page rather than the notice — otherwise an English "Reply" button lays
  // itself out right-to-left merely because the announcement above it is in
  // Persian. Carrying an explicit dir also keeps this whole block out of the
  // banner's `dir="auto"` resolution, which must follow the announcement.
  const uiDir = language === 'fa' ? 'rtl' : 'ltr';

  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  const mine = announcementReplies
    .filter((reply) => reply.announcement_id === announcement.id && reply.author_id === user?.id)
    .sort((a, b) => a.created.localeCompare(b.created));

  /**
   * Re-reads the list after a write. Deliberately separate from the write and
   * deliberately swallowing: the write has already succeeded by the time this
   * runs, so a failure here is a stale screen, not a failed action. Reporting
   * it as one is what invites somebody to send the same answer twice.
   */
  async function refresh() {
    try {
      setAnnouncementReplies(await fetchAnnouncementReplies());
    } catch {
      // Realtime and the sixty-second reconcile both correct this shortly.
    }
  }

  async function withdraw(id: string) {
    if (busy) return;
    setBusy(true);
    try {
      await deleteAnnouncementReply(id);
      addToast(t('announcement.reply_withdrawn'), 'success');
    } catch {
      addToast(t('announcement.reply_error'), 'error');
    } finally {
      await refresh();
      setBusy(false);
    }
  }

  async function send() {
    const message = body.trim();
    if (!message || busy || !user) return;
    setBusy(true);
    try {
      await createAnnouncementReply({
        announcementId: announcement.id,
        authorId: user.id,
        body: message,
      });
      // Clear the composer only once the answer is genuinely stored.
      setBody('');
      setOpen(false);
      addToast(t('announcement.reply_sent'), 'success');
    } catch {
      // The text stays in the box so it can be sent again.
      addToast(t('announcement.reply_error'), 'error');
    } finally {
      await refresh();
      setBusy(false);
    }
  }

  const replies = mine.length > 0 && (
    <ul className="announcement-replies">
      {mine.map((reply) => (
        <li key={reply.id} className="announcement-reply">
          {/* Its own direction: an answer need not be in the language of the
              notice. Carrying `dir` also keeps it out of the banner's own
              resolution, which should follow the announcement, not the reply. */}
          <p className="announcement-reply-body" dir="auto">
            {reply.body}
          </p>
          <span className="announcement-reply-meta">
            <DateDisplay date={reply.created} />
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-icon btn-sm btn-ghost-danger"
            onClick={() => withdraw(reply.id)}
            disabled={busy}
            aria-label={t('announcement.withdraw_reply')}
            title={t('announcement.withdraw_reply')}
          >
            <Trash2 size={13} />
          </button>
        </li>
      ))}
    </ul>
  );

  // Admins always may — that is what private.can_reply_announcements() says in
  // the database, and what the Settings table promises with "Always". The flag
  // is only ever set for members, so testing it alone would have left an admin
  // reading a permission they were never offered.
  const mayReply = user?.role === 'admin' || Boolean(user?.can_reply_announcements);

  // Somebody whose permission was taken away keeps the answers they already
  // gave, and can still withdraw them.
  if (!mayReply) {
    return replies ? <div className="announcement-reply-area" dir={uiDir}>{replies}</div> : null;
  }

  return (
    <div className="announcement-reply-area" dir={uiDir}>
      {replies}

      {open ? (
        <div className="announcement-reply-form">
          <textarea
            className="form-textarea announcement-reply-input"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder={t('announcement.reply_placeholder')}
            rows={3}
            maxLength={2000}
            // The answer carries its own direction, like the notice does.
            dir="auto"
            autoFocus
          />
          <div className="announcement-reply-actions">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                setOpen(false);
                setBody('');
              }}
              disabled={busy}
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={send}
              disabled={busy || !body.trim()}
            >
              {busy ? <Loader2 size={13} className="spin" /> : <Send size={13} />}
              {t('announcement.send_reply')}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="btn btn-secondary btn-sm announcement-reply-open"
          onClick={() => setOpen(true)}
        >
          <Send size={13} />
          {mine.length > 0 ? t('announcement.reply_again') : t('announcement.reply')}
        </button>
      )}
    </div>
  );
}
