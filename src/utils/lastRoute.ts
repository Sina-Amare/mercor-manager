const LAST_ROUTE_KEY = 'agnus-last-route';

/**
 * Where the user was when their session ended, so signing back in returns them
 * to it rather than to the dashboard. Kept in localStorage rather than router
 * state so it survives a reload, a crash, or a fresh tab.
 *
 * Lives in its own module because both App and Login need it, and importing one
 * from the other would close a cycle around the lazy route imports.
 */
export function rememberRoute(path: string) {
  try {
    if (path && !path.startsWith('/login')) {
      window.localStorage.setItem(LAST_ROUTE_KEY, path);
    }
  } catch {
    // Storage unavailable: sign-in falls back to the dashboard.
  }
}

export function recallRoute(): string {
  try {
    return window.localStorage.getItem(LAST_ROUTE_KEY) || '/';
  } catch {
    return '/';
  }
}
