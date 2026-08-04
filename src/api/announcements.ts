import { supabase } from './supabase';
import type { Announcement, AnnouncementLevel } from '../types';

const FIELDS = 'id,body,level,target_user_id,created_by,created,updated';

function announcementError(action: string, error: unknown) {
  const code =
    error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  if (code === 'PGRST205' || code === '42P01') {
    return new Error('Announcements have not been configured in Supabase yet');
  }
  const message =
    error instanceof Error
      ? error.message
      : error && typeof error === 'object' && 'message' in error
        ? String(error.message)
        : 'Unknown cloud error';
  return new Error(`${action} failed in Supabase: ${message}`);
}

/**
 * Everything the signed-in account is allowed to see.
 *
 * There is no filter here on purpose. Row level security already returns the
 * team-wide notices plus the ones addressed to this member, and everything to
 * an admin — a notice for somebody else never reaches this browser, so it
 * cannot be revealed by a filtering mistake in the interface.
 */
export async function fetchAnnouncements(): Promise<Announcement[]> {
  const { data, error } = await supabase
    .from('announcements')
    .select(FIELDS)
    .order('created', { ascending: false });

  if (error) throw announcementError('Loading announcements', error);
  return (data || []) as Announcement[];
}

export async function createAnnouncement(input: {
  body: string;
  level: AnnouncementLevel;
  targetUserId: string | null;
  createdBy: string;
}): Promise<Announcement> {
  const row = {
    id: `ann_${globalThis.crypto?.randomUUID?.().replace(/-/g, '') || Date.now()}`,
    body: input.body.trim(),
    level: input.level,
    target_user_id: input.targetUserId,
    created_by: input.createdBy,
  };

  const { data, error } = await supabase
    .from('announcements')
    .insert(row)
    .select(FIELDS)
    .single();

  if (error) throw announcementError('Publishing the announcement', error);
  return data as Announcement;
}

export async function updateAnnouncement(
  id: string,
  patch: { body?: string; level?: AnnouncementLevel; target_user_id?: string | null }
): Promise<Announcement> {
  const { data, error } = await supabase
    .from('announcements')
    .update(patch)
    .eq('id', id)
    .select(FIELDS)
    .single();

  if (error) throw announcementError('Updating the announcement', error);
  return data as Announcement;
}

export async function deleteAnnouncement(id: string): Promise<void> {
  const { error } = await supabase.from('announcements').delete().eq('id', id);
  if (error) throw announcementError('Taking the announcement down', error);
}

/**
 * The list is a handful of rows, so any change refetches the lot rather than
 * patching a local copy from the payload. A DELETE event on an RLS-filtered
 * table carries only the primary key, and re-reading is both shorter and
 * exactly right.
 */
export function subscribeToAnnouncements(onChange: () => void, onStatus?: (status: string) => void) {
  try {
    const channel = supabase
      .channel(`public:announcements:${globalThis.crypto?.randomUUID?.() || Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'announcements' }, () =>
        onChange()
      )
      .subscribe((status) => onStatus?.(status));

    return () => {
      void supabase.removeChannel(channel);
    };
  } catch {
    return () => {};
  }
}
