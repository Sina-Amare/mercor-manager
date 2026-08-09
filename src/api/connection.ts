/**
 * Whether the database is actually reachable from this browser.
 *
 * AGNUS is a static page talking to Supabase on another host, so the two can
 * be blocked independently — and on this team's network they routinely are.
 * The page keeps rendering perfectly while every write fails, which is
 * indistinguishable from the app being broken: you move a pin, it moves, and
 * nothing was saved.
 *
 * Every request the client makes runs through the wrapped `fetch` below, so
 * this needs no polling and no timer. A thrown fetch means the host could not
 * be reached at all; any HTTP response — including 401 or 500 — means the
 * connection itself is fine and the problem is something the caller handles.
 */

type Listener = (online: boolean) => void;

let online = true;
const listeners = new Set<Listener>();

function publish(next: boolean) {
  if (next === online) return;
  online = next;
  for (const listener of listeners) listener(online);
}

export function isOnline() {
  return online;
}

export function subscribeToConnection(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Wraps fetch so the reachable/unreachable state is a side effect of the
 * traffic the app already makes.
 *
 * Aborts are excluded deliberately: supabase-js cancels its own requests during
 * teardown, and treating that as a dropped connection would flash the warning
 * on ordinary navigation.
 */
export function connectionAwareFetch(input: RequestInfo | URL, init?: RequestInit) {
  return fetch(input, init).then(
    (response) => {
      publish(true);
      return response;
    },
    (error: unknown) => {
      const aborted =
        error instanceof DOMException ? error.name === 'AbortError' : init?.signal?.aborted;
      if (!aborted) publish(false);
      throw error;
    }
  );
}

// The browser's own signal is a useful hint, but not the answer: this network
// blocks individual hosts while the machine stays perfectly "online".
if (typeof window !== 'undefined') {
  window.addEventListener('offline', () => publish(false));
}
