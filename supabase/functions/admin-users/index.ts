// ═══════════════════════════════════════════════════════════════════════════
// admin-users — the only path that writes to public.users.
//
// The browser holds a publishable key, so user provisioning cannot live there:
// anyone could grant themselves the admin role. Every action below runs under
// the service role after verifying that the caller's JWT belongs to an active
// admin. The one exception is `backfill`, which runs before anybody has an Auth
// identity and is therefore gated on a one-time bootstrap secret instead.
//
// Deploy:
//   supabase functions deploy admin-users
//   supabase secrets set MIGRATION_SECRET=<one-time value>
// ═══════════════════════════════════════════════════════════════════════════

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { json, preflight } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const MIGRATION_SECRET = Deno.env.get('MIGRATION_SECRET') ?? '';

const MIN_PASSWORD_LENGTH = 8;
const USERNAME_PATTERN = /^[a-z0-9._-]{3,32}$/;
const USER_FIELDS = 'id,username,email,name,role,avatar,is_active,created,updated';

function admin(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Usernames map to a synthetic address so members keep signing in with the name
// they already know. src/api/auth.ts builds the same address.
function loginEmail(username: string): string {
  return `${username}@agnus.local`;
}

class RequestError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

async function requireAdmin(request: Request, service: SupabaseClient) {
  const authHeader = request.headers.get('Authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) throw new RequestError('Sign in first', 401);

  const { data, error } = await service.auth.getUser(token);
  if (error || !data.user) throw new RequestError('Session is not valid', 401);

  const { data: profile } = await service
    .from('users')
    .select('id,role,is_active')
    .eq('auth_user_id', data.user.id)
    .maybeSingle();

  if (!profile?.is_active) throw new RequestError('Account is not active', 403);
  if (profile.role !== 'admin') throw new RequestError('Admins only', 403);

  return profile as { id: string; role: string; is_active: boolean };
}

function validateUsername(username: string): string {
  const clean = username.trim().toLowerCase();
  if (!USERNAME_PATTERN.test(clean)) {
    throw new RequestError(
      'Username must be 3–32 letters, numbers, dots, dashes or underscores'
    );
  }
  return clean;
}

function validatePassword(password: string): string {
  const clean = password.trim();
  if (clean.length < MIN_PASSWORD_LENGTH) {
    throw new RequestError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  return clean;
}

// ─── Actions ─────────────────────────────────────────────────────────────────

async function createAccount(service: SupabaseClient, payload: Record<string, unknown>) {
  const username = validateUsername(String(payload.username ?? ''));
  const password = validatePassword(String(payload.password ?? ''));
  const name = String(payload.name ?? '').trim();
  const role = payload.role === 'admin' ? 'admin' : 'member';
  if (!name) throw new RequestError('Display name is required');

  const { data: existing } = await service
    .from('users')
    .select('id')
    .eq('username', username)
    .maybeSingle();
  if (existing) throw new RequestError(`Username "${username}" already exists`);

  const email = loginEmail(username);
  const { data: created, error: authError } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { username, name },
  });
  if (authError || !created.user) {
    throw new RequestError(authError?.message ?? 'Could not create the sign-in identity', 500);
  }

  const now = new Date().toISOString();
  const { data: profile, error: profileError } = await service
    .from('users')
    .insert({
      id: `user_${crypto.randomUUID()}`,
      auth_user_id: created.user.id,
      username,
      email,
      name,
      role,
      avatar: '',
      is_active: true,
      created: now,
      updated: now,
    })
    .select(USER_FIELDS)
    .single();

  if (profileError) {
    // Do not leave an orphaned sign-in identity behind.
    await service.auth.admin.deleteUser(created.user.id);
    throw new RequestError(profileError.message, 500);
  }

  return profile;
}

async function updateAccount(service: SupabaseClient, payload: Record<string, unknown>) {
  const id = String(payload.id ?? '');
  if (!id) throw new RequestError('User id is required');

  const { data: current } = await service
    .from('users')
    .select('id,auth_user_id,username,role,is_active')
    .eq('id', id)
    .maybeSingle();
  if (!current) throw new RequestError('User not found', 404);

  const updates: Record<string, unknown> = { updated: new Date().toISOString() };

  if (typeof payload.name === 'string' && payload.name.trim()) {
    updates.name = payload.name.trim();
  }
  if (typeof payload.role === 'string') {
    updates.role = payload.role === 'admin' ? 'admin' : 'member';
  }
  if (typeof payload.is_active === 'boolean') {
    updates.is_active = payload.is_active;
  }

  let nextUsername = current.username as string;
  if (typeof payload.username === 'string' && payload.username.trim()) {
    nextUsername = validateUsername(payload.username);
    if (nextUsername !== current.username) {
      const { data: clash } = await service
        .from('users')
        .select('id')
        .eq('username', nextUsername)
        .neq('id', id)
        .maybeSingle();
      if (clash) throw new RequestError(`Username "${nextUsername}" already exists`);
      updates.username = nextUsername;
      updates.email = loginEmail(nextUsername);
    }
  }

  // Sign-in address and password live in auth.users, not here.
  const authUpdates: Record<string, unknown> = {};
  if (updates.email) authUpdates.email = updates.email;
  if (typeof payload.password === 'string' && payload.password.trim()) {
    authUpdates.password = validatePassword(payload.password);
  }
  if (Object.keys(authUpdates).length > 0) {
    if (!current.auth_user_id) {
      throw new RequestError('This account has no sign-in identity yet — run backfill first');
    }
    const { error } = await service.auth.admin.updateUserById(
      current.auth_user_id as string,
      authUpdates
    );
    if (error) throw new RequestError(error.message, 500);
  }

  const { data: profile, error } = await service
    .from('users')
    .update(updates)
    .eq('id', id)
    .select(USER_FIELDS)
    .single();
  if (error) throw new RequestError(error.message, 500);

  return profile;
}

// Deactivation is the reversible option and the one the UI offers by default:
// the account can no longer sign in, but their task history stays intact.
async function setActive(
  service: SupabaseClient,
  payload: Record<string, unknown>,
  actorId: string
) {
  const id = String(payload.id ?? '');
  const isActive = payload.is_active === true;
  if (!id) throw new RequestError('User id is required');
  if (id === actorId && !isActive) {
    throw new RequestError('You cannot deactivate your own account');
  }
  return updateAccount(service, { id, is_active: isActive });
}

async function deleteAccount(
  service: SupabaseClient,
  payload: Record<string, unknown>,
  actorId: string
) {
  const id = String(payload.id ?? '');
  if (!id) throw new RequestError('User id is required');
  if (id === actorId) throw new RequestError('You cannot remove your own account');

  const { data: current } = await service
    .from('users')
    .select('id,auth_user_id')
    .eq('id', id)
    .maybeSingle();
  if (!current) return { id };

  if (current.auth_user_id) {
    await service.auth.admin.deleteUser(current.auth_user_id as string);
  }
  const { error } = await service.from('users').delete().eq('id', id);
  if (error) throw new RequestError(error.message, 500);

  return { id };
}

// One-time migration: create an Auth identity for every legacy row that still
// carries a browser-comparable password, then link it. Gated on a bootstrap
// secret because at this point nobody has an Auth session to prove admin with.
async function backfill(service: SupabaseClient, payload: Record<string, unknown>) {
  if (!MIGRATION_SECRET) {
    throw new RequestError('MIGRATION_SECRET is not configured', 500);
  }
  if (String(payload.secret ?? '') !== MIGRATION_SECRET) {
    throw new RequestError('Invalid migration secret', 403);
  }

  const { data: legacy, error } = await service
    .from('users')
    .select('id,username,email,name,password,auth_user_id')
    .is('auth_user_id', null);
  if (error) throw new RequestError(error.message, 500);

  const results: { username: string; ok: boolean; reason?: string }[] = [];

  for (const row of legacy ?? []) {
    const username = String(row.username ?? '').toLowerCase();
    const password = String(row.password ?? '');
    if (password.length < MIN_PASSWORD_LENGTH) {
      // Give short legacy passwords a random one; the admin resets it after.
      results.push({
        username,
        ok: false,
        reason: 'password too short for Supabase Auth — reset it from Settings',
      });
      continue;
    }

    const { data: created, error: authError } = await service.auth.admin.createUser({
      email: loginEmail(username),
      password,
      email_confirm: true,
      user_metadata: { username, name: row.name },
    });
    if (authError || !created.user) {
      results.push({ username, ok: false, reason: authError?.message ?? 'unknown error' });
      continue;
    }

    const { error: linkError } = await service
      .from('users')
      .update({ auth_user_id: created.user.id, email: loginEmail(username) })
      .eq('id', row.id);
    if (linkError) {
      await service.auth.admin.deleteUser(created.user.id);
      results.push({ username, ok: false, reason: linkError.message });
      continue;
    }

    results.push({ username, ok: true });
  }

  return {
    linked: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok),
  };
}

// ─── Entry point ─────────────────────────────────────────────────────────────

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;

  if (request.method !== 'POST') {
    return json(request, { error: 'Use POST' }, 405);
  }

  const service = admin();

  try {
    const payload = (await request.json()) as Record<string, unknown>;
    const action = String(payload.action ?? '');

    if (action === 'backfill') {
      return json(request, await backfill(service, payload));
    }

    const actor = await requireAdmin(request, service);

    switch (action) {
      case 'create':
        return json(request, await createAccount(service, payload));
      case 'update':
        return json(request, await updateAccount(service, payload));
      case 'set_active':
        return json(request, await setActive(service, payload, actor.id));
      case 'delete':
        return json(request, await deleteAccount(service, payload, actor.id));
      default:
        return json(request, { error: `Unknown action "${action}"` }, 400);
    }
  } catch (error) {
    const status = error instanceof RequestError ? error.status : 500;
    const message = error instanceof Error ? error.message : 'Unexpected error';
    return json(request, { error: message }, status);
  }
});
