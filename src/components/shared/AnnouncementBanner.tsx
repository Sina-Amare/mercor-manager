import { useEffect, useState } from 'react';
import { AlertTriangle, Info, Megaphone, X } from 'lucide-react';
import { useAppStore, useLanguageStore } from '../../store';
import type { AnnouncementLevel } from '../../types';

const SEEN_KEY = 'agnus:announcement-seen';

const LEVEL_ICON: Record<AnnouncementLevel, typeof Info> = {
  info: Megaphone,
  warning: AlertTriangle,
  critical: AlertTriangle,
};

function readSeen(): string {
  try {
    return window.localStorage.getItem(SEEN_KEY) || '';
  } catch {
    return '';
  }
}

/**
 * The team-wide notice, shown on every page until it is dismissed.
 *
 * Dismissal is keyed on when the announcement last changed, so closing today's
 * notice does not also hide tomorrow's — an admin editing the text brings it
 * back for everyone who had already dismissed the previous one.
 *
 * The text carries its own direction. `dir="auto"` makes the browser pick RTL or
 * LTR from the first strong character in the message itself, so a Persian notice
 * reads right-to-left even for somebody using the English interface, and vice
 * versa. The font stack lists both faces and lets per-glyph fallback handle a
 * message that mixes scripts.
 */
export default function AnnouncementBanner() {
  const { settings } = useAppStore();
  const { t } = useLanguageStore();
  const [seen, setSeen] = useState(readSeen);

  const text = settings.announcement_text?.trim() ?? '';
  const level = (settings.announcement_level as AnnouncementLevel) || 'info';
  const stamp = settings.announcement_updated || '';

  // A new or edited notice un-dismisses itself.
  useEffect(() => {
    if (stamp && stamp !== seen) setSeen(readSeen());
  }, [seen, stamp]);

  if (!text) return null;
  if (stamp && stamp === seen) return null;

  const Icon = LEVEL_ICON[level] ?? Megaphone;

  const dismiss = () => {
    try {
      window.localStorage.setItem(SEEN_KEY, stamp);
    } catch {
      // Storage unavailable: it simply reappears next load.
    }
    setSeen(stamp);
  };

  return (
    <aside
      className={`announcement announcement-${level}`}
      // The banner takes its direction from the message, so the coloured rule
      // and the icon land at the start of the text rather than at the start of
      // the page. A Persian notice then reads as one composed block inside an
      // English interface instead of a mirrored fragment.
      dir="auto"
      role={level === 'critical' ? 'alert' : 'status'}
      aria-label={t('announcement.aria_label')}
    >
      <Icon className="announcement-icon" size={20} aria-hidden="true" />
      <p className="announcement-text" dir="auto">
        {text}
      </p>
      <button
        type="button"
        className="btn btn-ghost btn-icon btn-sm announcement-dismiss"
        onClick={dismiss}
        aria-label={t('announcement.dismiss')}
        title={t('announcement.dismiss')}
      >
        <X size={16} />
      </button>
    </aside>
  );
}
