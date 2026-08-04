import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useLanguageStore } from '../../store';
import { watchForNewBuild } from '../../utils/buildVersion';
import { reloadWithCacheBust } from '../../utils/pageRecovery';

/**
 * Says so when this tab is running an old build.
 *
 * It asks rather than reloading by itself: a forced reload in the middle of
 * writing a submission is worse than a stale tab, even with auto-save. It also
 * cannot be dismissed — the whole problem is a tab that looks fine and is not.
 */
export default function UpdateBanner() {
  const { t } = useLanguageStore();
  const [stale, setStale] = useState(false);

  useEffect(() => watchForNewBuild(() => setStale(true)), []);

  if (!stale) return null;

  return (
    <aside className="update-banner" role="status">
      <RefreshCw className="update-banner-icon" size={18} aria-hidden="true" />
      <p className="update-banner-text">{t('common.update_available')}</p>
      {/* The same cache-busting reload the chunk-load recovery uses: plain
          reload() can be answered from the very cache that is the problem. It
          tidies its own parameter out of the address bar afterwards. */}
      <button type="button" className="btn btn-primary btn-sm" onClick={reloadWithCacheBust}>
        <RefreshCw size={14} />
        {t('common.reload_now')}
      </button>
    </aside>
  );
}
