/**
 * Notices that a newer build has been deployed while this tab stayed open.
 *
 * Vite fingerprints every chunk, so a deployed change always renames the entry
 * script — but `index.html` is the one file that is *not* fingerprinted, and it
 * is what points at the entry. A browser holding a cached copy of it keeps
 * loading yesterday's application indefinitely, which is how a tab ends up on a
 * build two releases old with no sign that anything is wrong. That is worse
 * than cosmetic when a release also changes the database: the stale build asks
 * for columns that no longer exist.
 *
 * So: re-read index.html, ignoring the cache, and compare the entry it names
 * against the one this tab actually loaded. No build step, no version file to
 * keep in step, nothing to forget to bump.
 */

/** The entry script this tab is running, as index.html named it. */
function loadedEntry(): string | null {
  const script = document.querySelector<HTMLScriptElement>('script[type="module"][src]');
  return script ? new URL(script.src, document.baseURI).pathname : null;
}

async function deployedEntry(): Promise<string | null> {
  // `cache: 'no-store'` is the point of the whole exercise — a conditional
  // request would be answered from the same stale copy.
  const response = await fetch(`${import.meta.env.BASE_URL}index.html`, {
    cache: 'no-store',
    headers: { Accept: 'text/html' },
  });
  if (!response.ok) return null;

  const html = await response.text();
  const match = /<script[^>]+type="module"[^>]+src="([^"]+)"/.exec(html);
  if (!match) return null;
  return new URL(match[1], document.baseURI).pathname;
}

/**
 * Calls `onStale` once, when the deployed entry stops matching this tab's.
 *
 * Checks when the tab is brought back to the foreground, which is when somebody
 * is about to use it, plus a slow interval for a tab left visible all day.
 * Anything the check cannot answer — offline, a 404, a served error page — is
 * treated as "no news", never as a new build.
 */
export function watchForNewBuild(onStale: () => void, intervalMs = 15 * 60_000): () => void {
  const mine = loadedEntry();
  // The dev server serves /src/main.tsx unhashed, so there is nothing to watch.
  if (!mine || !mine.includes('/assets/')) return () => {};

  let stopped = false;
  let checking = false;

  // Declared before `check` so the answer-once path can tear everything down
  // rather than leave an interval and three listeners firing into a guard for
  // the rest of the day.
  let stop = () => {
    stopped = true;
  };

  const check = async () => {
    if (stopped || checking || !navigator.onLine) return;
    checking = true;
    try {
      const theirs = await deployedEntry();
      if (!stopped && theirs && theirs !== mine) {
        stop();
        onStale();
      }
    } catch {
      // Offline or a transient failure. Nothing has been learned; try later.
    } finally {
      checking = false;
    }
  };

  const onVisible = () => {
    if (document.visibilityState === 'visible') void check();
  };

  const timer = window.setInterval(() => void check(), intervalMs);
  window.addEventListener('focus', onVisible);
  window.addEventListener('online', onVisible);
  document.addEventListener('visibilitychange', onVisible);

  stop = () => {
    stopped = true;
    window.clearInterval(timer);
    window.removeEventListener('focus', onVisible);
    window.removeEventListener('online', onVisible);
    document.removeEventListener('visibilitychange', onVisible);
  };

  void check();

  return () => stop();
}
