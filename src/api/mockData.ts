import type { User, Task, AppSettings } from '../types';

export const MOCK_USERS: User[] = [
  {
    id: 'user_admin',
    username: 'admin',
    email: 'admin@agnus.local',
    name: 'Sina (Admin)',
    role: 'admin',
    avatar: '',
    is_active: true,
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
  },
  {
    id: 'user_nasi',
    username: 'nasi',
    email: 'nasi@agnus.local',
    name: 'Nastaran',
    role: 'member',
    avatar: '',
    is_active: true,
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
  },
  {
    id: 'user_milad',
    username: '0vertrue',
    email: 'milad@agnus.local',
    name: 'Milad',
    role: 'member',
    avatar: '',
    is_active: true,
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
  },
];

export const MOCK_TASKS: Task[] = [];

export const MOCK_SETTINGS: AppSettings = {
  id: 'settings_1',
  usd_to_irr_rate: 878000,
  updated: new Date().toISOString(),
};
