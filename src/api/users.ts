import { supabase, SUPABASE_FUNCTIONS_URL } from './supabase';
import type { User } from '../types';

// Every write to public.users goes through the admin-users Edge Function, which
// runs under the service role after checking the caller is an active admin.
// The browser cannot be trusted with role assignment or password resets.

async function callAdminUsers<T>(action: string, payload: Record<string, unknown>): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Sign in again to manage team members');

  const response = await fetch(`${SUPABASE_FUNCTIONS_URL}/admin-users`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action, ...payload }),
  });

  const body = (await response.json().catch(() => ({}))) as { error?: string } & T;
  if (!response.ok) {
    throw new Error(body?.error || `Could not ${action.replace('_', ' ')} the member`);
  }
  return body;
}

export function createUser(input: {
  username: string;
  password: string;
  name: string;
  role: 'admin' | 'member';
}): Promise<User> {
  return callAdminUsers<User>('create', input);
}

export function updateUser(
  id: string,
  input: {
    username?: string;
    name?: string;
    role?: 'admin' | 'member';
    password?: string;
    is_active?: boolean;
    can_reply_announcements?: boolean;
  }
): Promise<User> {
  return callAdminUsers<User>('update', { id, ...input });
}

/** Who may answer an announcement. Admins always may; this is for members. */
export function setCanReplyAnnouncements(id: string, canReply: boolean): Promise<User> {
  return callAdminUsers<User>('update', { id, can_reply_announcements: canReply });
}

/** Reversible removal: the account can no longer sign in, history stays intact. */
export function setUserActive(id: string, isActive: boolean): Promise<User> {
  return callAdminUsers<User>('set_active', { id, is_active: isActive });
}

/** Irreversible. Prefer setUserActive unless the row must really disappear. */
export function deleteUser(id: string): Promise<{ id: string }> {
  return callAdminUsers<{ id: string }>('delete', { id });
}

/**
 * Restores user rows from a backup.
 *
 * The client lost its write grant on public.users when RLS was cut over
 * (rightly — role assignment cannot live in the browser), so an import has to
 * go through the Edge Function like every other users write.
 */
export function importUsers(users: User[]): Promise<User[]> {
  return callAdminUsers<User[]>('import', { users });
}
