import { supabase } from './supabase';
import type { User } from '../types';
import { useAuthStore } from '../store';
import { validateLocalLogin } from './tasks';

export async function login(username: string, password: string): Promise<User> {
  const cleanUsername = username.trim().toLowerCase();
  const cleanPassword = password.trim();

  // Try Supabase Cloud users table
  try {
    const { data } = await supabase
      .from('users')
      .select('*')
      .ilike('username', cleanUsername);

    if (data && data.length > 0) {
      const user = data[0] as User & { password?: string };
      if (!user.password || user.password === cleanPassword) {
        useAuthStore.getState().login(user, 'supabase_token_' + user.id);
        return user;
      }
    }
  } catch {
    // Ignore error and fall back
  }

  // Fallback to local validation
  const foundUser = validateLocalLogin(username, password);
  if (foundUser) {
    useAuthStore.getState().login(foundUser, 'demo_token_' + foundUser.id);
    return foundUser;
  }
  throw new Error('Invalid username or password');
}

export function logout() {
  useAuthStore.getState().logout();
}

export function isLoggedIn(): boolean {
  return !!useAuthStore.getState().user;
}

export function getCurrentUser(): User | null {
  return useAuthStore.getState().user;
}

export function restoreSession(): boolean {
  const current = useAuthStore.getState().user;
  return !!current;
}
