const RECOVERY_PARAMETER = '_app_refresh';
const RECOVERY_STORAGE_PREFIX = 'agnus:chunk-recovery:';

function recoveryStorageKey() {
  return `${RECOVERY_STORAGE_PREFIX}${__APP_BUILD_ID__}`;
}

function recoveryAlreadyAttempted() {
  const recoveryMarker = new URL(window.location.href).searchParams.get(RECOVERY_PARAMETER);
  if (recoveryMarker?.startsWith(`${__APP_BUILD_ID__}-`)) return true;

  try {
    return window.sessionStorage.getItem(recoveryStorageKey()) === 'attempted';
  } catch {
    return false;
  }
}

function markRecoveryAttempted() {
  try {
    window.sessionStorage.setItem(recoveryStorageKey(), 'attempted');
  } catch {
    // The cache-busting URL also prevents a loop when storage is unavailable.
  }
}

export function reloadWithCacheBust() {
  const url = new URL(window.location.href);
  url.searchParams.set(RECOVERY_PARAMETER, `${__APP_BUILD_ID__}-${Date.now()}`);
  window.location.replace(url.toString());
}

export function installChunkLoadRecovery() {
  const handlePreloadError = (event: Event) => {
    // Reload once per deployed build. If that build still cannot start,
    // allow the error boundary to show a retry screen instead of looping.
    if (recoveryAlreadyAttempted()) return;

    event.preventDefault();
    markRecoveryAttempted();
    reloadWithCacheBust();
  };

  window.addEventListener('vite:preloadError', handlePreloadError);
}

export function scheduleRecoveryUrlCleanup() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(RECOVERY_PARAMETER)) return;

  window.setTimeout(() => {
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete(RECOVERY_PARAMETER);
    window.history.replaceState(
      window.history.state,
      '',
      `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`
    );
  }, 5000);
}
