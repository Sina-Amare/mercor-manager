import { useState } from 'react';
import { AlertTriangle, Megaphone, UserRound, X } from 'lucide-react';
import { useAppStore, useAuthStore, useLanguageStore } from '../../store';
import type { Announcement, AnnouncementLevel } from '../../types';

const SEEN_KEY = 'agnus:announcements-seen';

const LEVEL_ICON: Record<AnnouncementLevel, typeof Megaphone> = {
  info: Megaphone,
  warning: AlertTriangle,
  critical: AlertTriangle,
};

/**
 * A notice is identified by what it says, not just by which row it is: editing
 * one changes `updated`, which brings it back for everybody who had already
 * closed the previous wording.
 */
const seenKey = (announcement: Announcement) => `${announcement.id}:${announcement.updated}`;

function readSeen(): Set<string> {
  try {
    const raw = window.localStorage.getItem(SEEN_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

const LEVEL_ORDER: Record<AnnouncementLevel, number> = { critical: 0, warning: 1, info: 2 };

/**
 * Every notice this account is meant to read, at the top of every page.
 *
 * Addressed-to-you comes before team-wide, then urgency, then newest — a
 * message written for one person is the one they most need to see, and it is
 * marked so it does not read as another broadcast.
 *
 * Direction is the message's own. `dir="auto"` on the banner makes the browser
 * pick RTL or LTR from the first strong character of the text itself, so a
 * Persian notice reads right-to-left for somebody using the English interface,
 * with the coloured rule and icon at the start of the sentence rather than the
 * start of the page.
 *
 * The message paragraph deliberately carries no `dir` of its own. A descendant
 * with a `dir` attribute — including `dir="auto"` — is excluded from its
 * ancestor's auto resolution, so marking up the paragraph left the banner with
 * no text to judge and it silently fell back to left-to-right. The tag, which
 * is interface text rather than part of the message, carries an explicit
 * direction for exactly that reason: to stay out of the decision.
 *
 * The font stack names both faces and lets per-glyph fallback handle a message
 * that mixes scripts.
 */
export default function AnnouncementBanner() {
  const { announcements } = useAppStore();
  const { user } = useAuthStore();
  const { t, language } = useLanguageStore();
  const [seen, setSeen] = useState(readSeen);

  const visible = announcements
    .filter((announcement) => {
      if (!announcement.body.trim()) return false;
      if (seen.has(seenKey(announcement))) return false;
      // An admin manages notices for other people from Settings; the banner is
      // only what is addressed to the person reading it.
      return !announcement.target_user_id || announcement.target_user_id === user?.id;
    })
    .sort((a, b) => {
      const personal = Number(Boolean(b.target_user_id)) - Number(Boolean(a.target_user_id));
      if (personal) return personal;
      const urgency = LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level];
      if (urgency) return urgency;
      return b.created.localeCompare(a.created);
    });

  if (visible.length === 0) return null;

  const dismiss = (announcement: Announcement) => {
    const next = new Set(seen).add(seenKey(announcement));
    // Keep only what is still live, or the list grows for ever.
    const live = new Set(announcements.map(seenKey));
    const pruned = new Set([...next].filter((key) => live.has(key)));
    try {
      window.localStorage.setItem(SEEN_KEY, JSON.stringify([...pruned]));
    } catch {
      // Storage unavailable: the notice simply reappears next load.
    }
    setSeen(pruned);
  };

  return (
    <div className="announcement-stack">
      {visible.map((announcement) => {
        const Icon = LEVEL_ICON[announcement.level] ?? Megaphone;
        const forMe = Boolean(announcement.target_user_id);
        return (
          <aside
            key={announcement.id}
            className={`announcement announcement-${announcement.level}${forMe ? ' is-personal' : ''}`}
            dir="auto"
            role={announcement.level === 'critical' ? 'alert' : 'status'}
            aria-label={forMe ? t('announcement.aria_label_personal') : t('announcement.aria_label')}
          >
            <Icon className="announcement-icon" size={20} aria-hidden="true" />
            <div className="announcement-content">
              {forMe && (
                <span className="announcement-tag" dir={language === 'fa' ? 'rtl' : 'ltr'}>
                  <UserRound size={12} aria-hidden="true" />
                  {t('announcement.for_you')}
                </span>
              )}
              <p className="announcement-text">{announcement.body}</p>
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-icon btn-sm announcement-dismiss"
              onClick={() => dismiss(announcement)}
              aria-label={t('announcement.dismiss')}
              title={t('announcement.dismiss')}
            >
              <X size={16} />
            </button>
          </aside>
        );
      })}
    </div>
  );
}
