// AGNUS is served from GitHub Pages, so every Edge Function is cross-origin.
// ALLOWED_ORIGINS is a comma-separated list of the origins that may call these
// functions from a browser; set it to the deployed site in production.
//
// When unset we allow any origin. That only relaxes the browser's same-origin
// check — it is not authentication. Every action except `backfill` verifies a
// valid admin JWT server-side, and that token travels in the Authorization
// header of the request itself: a foreign page cannot read it out of this
// site's storage, and no credentials (cookies) are involved for '*' to leak.

const allowList = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

export function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('Origin') ?? '';
  // A listed-but-unmatched origin gets no Access-Control-Allow-Origin header
  // at all — the browser blocks the response, which is the point of the list.
  // (Echoing the first allowed origin instead was a header the browser would
  // reject anyway.)
  const allowed =
    allowList.length === 0 ? '*' : origin !== '' && allowList.includes(origin) ? origin : null;

  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
  if (allowed) headers['Access-Control-Allow-Origin'] = allowed;
  return headers;
}

export function json(request: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), 'Content-Type': 'application/json' },
  });
}

export function preflight(request: Request): Response | null {
  if (request.method !== 'OPTIONS') return null;
  return new Response('ok', { headers: corsHeaders(request) });
}
