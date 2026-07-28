import pb from './pb';
import type { User } from '../types';
import { useAuthStore } from '../store';
import { MOCK_USERS } from './mockData';

export async function login(username: string, password: string): Promise<User> {
  try {
    const authData = await pb.collection('users').authWithPassword(username, password);
    const user = authData.record as unknown as User;
    useAuthStore.getState().login(user, pb.authStore.token);
    return user;
  } catch (err) {
    // Fallback to standalone/demo auth if PB is offline or collection doesn't exist yet
    const foundUser = MOCK_USERS.find(
      (u) => u.username.toLowerCase() === username.trim().toLowerCase()
    );
    if (foundUser) {
      useAuthStore.getState().login(foundUser, 'demo_token_' + foundUser.id);
      return foundUser;
    }
    throw err;
  }
}

export function logout() {
  pb.authStore.clear();
  useAuthStore.getState().logout();
}

export function isLoggedIn(): boolean {
  return pb.authStore.isValid || !!useAuthStore.getState().user;
}

export function getCurrentUser(): User | null {
  if (pb.authStore.isValid && pb.authStore.record) {
    return pb.authStore.record as unknown as User;
  }
  return useAuthStore.getState().user;
}

export function restoreSession(): boolean {
  if (pb.authStore.isValid && pb.authStore.record) {
    const user = pb.authStore.record as unknown as User;
    useAuthStore.getState().login(user, pb.authStore.token);
    return true;
  }
  const current = useAuthStore.getState().user;
  return !!current;
}
