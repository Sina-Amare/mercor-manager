import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Loader2, Megaphone, Send, Trash2 } from 'lucide-react';
import type { AnnouncementLevel, AppSettings } from '../../types';
import { useLanguageStore } from '../../store';

const LEVELS: readonly AnnouncementLevel[] = ['info', 'warning', 'critical'];

interface Props {
  settings: AppSettings;
  busy: boolean;
  onPublish: (text: string, level: AnnouncementLevel) => void;
  onClear: () => void;
}

/**
 * Writes the team-wide notice.
 *
 * The preview is the point: it renders with exactly the component, direction
 * detection and typography members will get, so a Persian notice can be checked
 * for right-to-left rendering before anyone else sees it — rather than
 * publishing and then asking somebody whether it looks right.
 */
export default function AnnouncementEditor({ settings, busy, onPublish, onClear }: Props) {
  const { t } = useLanguageStore();
  const [text, setText] = useState(settings.announcement_text || '');
  const [level, setLevel] = useState<AnnouncementLevel>(settings.announcement_level || 'info');

  // Never overwrite what an admin is typing when another admin's change lands.
  const editingRef = useRef(false);
  editingRef.current =
    text !== (settings.announcement_text || '') || level !== (settings.announcement_level || 'info');

  useEffect(() => {
    if (editingRef.current) return;
    setText(settings.announcement_text || '');
    setLevel(settings.announcement_level || 'info');
  }, [settings.announcement_text, settings.announcement_level]);

  const dirty = editingRef.current;
  const live = Boolean(settings.announcement_text?.trim());
  const Icon = level === 'info' ? Megaphone : AlertTriangle;

  return (
    <section className="card">
      <div className="card-header">
        <h2 className="card-title">{t('announcement.title')}</h2>
        {live && <span className="status-badge announcement-live">{t('announcement.live')}</span>}
      </div>
      <p className="card-help">{t('announcement.help')}</p>

      <div className="form-group">
        <label className="form-label" htmlFor="announcement-text">
          {t('announcement.message')}
        </label>
        <textarea
          id="announcement-text"
          className="form-textarea announcement-input"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={t('announcement.placeholder')}
          rows={4}
          maxLength={600}
          // Written in whatever language suits; the field follows the text.
          dir="auto"
        />
        <small className="announcement-count">{text.length} / 600</small>
      </div>

      <div className="form-group">
        <span className="form-label">{t('announcement.level')}</span>
        <div className="announcement-levels" role="radiogroup" aria-label={t('announcement.level')}>
          {LEVELS.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={level === option}
              className={`announcement-level-option is-${option} ${
                level === option ? 'active' : ''
              }`}
              onClick={() => setLevel(option)}
            >
              {t(`announcement.level_${option}`)}
            </button>
          ))}
        </div>
      </div>

      {text.trim() && (
        <div className="announcement-preview">
          <span className="announcement-preview-label">{t('announcement.preview')}</span>
          <aside className={`announcement announcement-${level} is-preview`} dir="auto">
            <Icon className="announcement-icon" size={20} aria-hidden="true" />
            <p className="announcement-text" dir="auto">
              {text}
            </p>
          </aside>
        </div>
      )}

      <div className="announcement-actions">
        {live && (
          <button className="btn btn-secondary btn-sm btn-ghost-danger" onClick={onClear} disabled={busy}>
            <Trash2 size={14} />
            {t('announcement.clear')}
          </button>
        )}
        <button
          className="btn btn-primary"
          onClick={() => onPublish(text, level)}
          disabled={busy || !dirty || !text.trim()}
        >
          {busy ? <Loader2 size={15} className="spin" /> : <Send size={15} />}
          {live ? t('announcement.update') : t('announcement.publish')}
        </button>
      </div>
    </section>
  );
}
