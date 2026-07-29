import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { User } from '../types';
import { useAuthStore } from '../store';

const PROFILE_FIELDS = 'id,username,email,name,role,avatar,is_active,created,updated';

// Members sign in with the username they already know; the sign-in address is
// derived from it, so there is no lookup table and no email disclosure. The
// admin-users Edge Function builds the same address when provisioning.
function loginEmail(username: string): string {
  return `${username.trim().toLowerCase()}@agnus.local`;
}

async function loadProfile(authUserId: string): Promise<User | null> {
  const { data, error } = await supabase
    .from('users')
    .select(PROFILE_FIELDS)
    .eq('auth_user_id', authUserId)
    .maybeSingle();

  if (error || !data) return null;
  const profile = data as User;
  return profile.is_active ? profile : null;
}

export async function login(username: string, password: string): Promise<User> {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: loginEmail(username),
    password: password.trim(),
  });

  if (error || !data.user) {
    throw new Error('Invalid username or password');
  }

  const profile = await loadProfile(data.user.id);
  if (!profile) {
    await supabase.auth.signOut();
    throw new Error('This account is not active');
  }

  useAuthStore.getState().login(profile);
  return profile;
}

export async function logout() {
  await supabase.auth.signOut();
  useAuthStore.getState().logout();
}

/**
 * Keeps the auth store in step with the Supabase session for the life of the
 * tab: first load, token refresh, sign-out, and sign-out from another tab.
 * Calls `onReady` once the first session has resolved, so the app knows when to
 * stop showing the splash. Returns an unsubscribe function.
 */
export function initAuth(onReady: () => void): () => void {
  let settled = false;
  const settle = () => {
    if (settled) return;
    settled = true;
    onReady();
  };

  const apply = async (session: Session | null) => {
    if (!session?.user) {
      useAuthStore.getState().logout();
      settle();
      return;
    }

    const profile = await loadProfile(session.user.id);
    if (profile) {
      useAuthStore.getState().login(profile);
    } else {
      // Signed in to Supabase with no active AGNUS account behind it.
      await supabase.auth.signOut();
      useAuthStore.getState().logout();
    }
    settle();
  };

  void supabase.auth.getSession().then(({ data }) => apply(data.session));

  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    void apply(session);
  });

  return () => data.subscription.unsubscribe();
}

