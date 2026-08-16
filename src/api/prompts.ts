import { supabase } from './supabase';
import { wrapSupabaseError } from './errors';
import type { SavedPrompt, User } from '../types';

const PROMPT_FIELDS =
  'id,title,body,visibility,owner_id,created_by,created,updated';

const promptError = (action: string, error: unknown) =>
  wrapSupabaseError(action, error, 'Prompt storage has not been configured in Supabase yet');

function canEditPrompt(prompt: SavedPrompt, actor: User) {
  if (prompt.created_by) return prompt.created_by === actor.id;
  return prompt.visibility === 'public'
    ? actor.role === 'admin'
    : prompt.owner_id === actor.id;
}

function canDeletePrompt(prompt: SavedPrompt, actor: User) {
  return prompt.visibility === 'public'
    ? actor.role === 'admin'
    : prompt.owner_id === actor.id;
}

export async function fetchPrompts(userId: string): Promise<SavedPrompt[]> {
  const { data, error } = await supabase
    .from('prompts')
    .select(PROMPT_FIELDS)
    .or(`visibility.eq.public,owner_id.eq.${userId}`)
    .order('updated', { ascending: false });

  if (error) throw promptError('Fetching prompts', error);
  return (data || []) as SavedPrompt[];
}

export async function createPrompt(
  input: { title: string; body: string; visibility: SavedPrompt['visibility'] },
  actor: User
): Promise<SavedPrompt> {
  const title = input.title.trim();
  const body = input.body.trim();
  if (!title || !body) throw new Error('Prompt title and content are required');
  if (input.visibility === 'public' && actor.role !== 'admin') {
    throw new Error('Only admins can create shared prompts');
  }

  const now = new Date().toISOString();
  const prompt: SavedPrompt = {
    id: `prompt_${globalThis.crypto?.randomUUID?.() || Date.now()}`,
    title,
    body,
    visibility: input.visibility,
    owner_id: input.visibility === 'personal' ? actor.id : null,
    created_by: actor.id,
    created: now,
    updated: now,
  };

  const { data, error } = await supabase
    .from('prompts')
    .insert(prompt)
    .select(PROMPT_FIELDS)
    .single();

  if (error) throw promptError('Creating prompt', error);
  return data as SavedPrompt;
}

export class PromptConflictError extends Error {
  constructor() {
    super('Prompt changed on another device');
    this.name = 'PromptConflictError';
  }
}

export async function updatePrompt(
  id: string,
  updates: { title: string; body: string },
  actor: User,
  /** Version the edit started from. Omitted only by callers with no baseline. */
  expectedUpdated?: string
): Promise<SavedPrompt> {
  const title = updates.title.trim();
  const body = updates.body.trim();
  if (!title || !body) throw new Error('Prompt title and content are required');

  const { data: currentData, error: currentError } = await supabase
    .from('prompts')
    .select(PROMPT_FIELDS)
    .eq('id', id)
    .maybeSingle();
  if (currentError) throw promptError('Loading prompt', currentError);
  if (!currentData) throw new Error('Prompt no longer exists');

  const current = currentData as SavedPrompt;
  if (!canEditPrompt(current, actor)) {
    throw new Error('Only the prompt creator can edit this prompt');
  }

  // Guard on the version the editor opened, so a second editor's save is
  // refused instead of quietly overwriting the first.
  let query = supabase
    .from('prompts')
    .update({ title, body, updated: new Date().toISOString() })
    .eq('id', id);
  if (expectedUpdated) query = query.eq('updated', expectedUpdated);

  const { data, error } = await query.select(PROMPT_FIELDS).maybeSingle();

  if (error) throw promptError('Updating prompt', error);
  if (!data) throw new PromptConflictError();
  return data as SavedPrompt;
}

export async function deletePrompt(id: string, actor: User): Promise<void> {
  const { data: currentData, error: currentError } = await supabase
    .from('prompts')
    .select(PROMPT_FIELDS)
    .eq('id', id)
    .maybeSingle();
  if (currentError) throw promptError('Loading prompt', currentError);
  if (!currentData) return;

  const current = currentData as SavedPrompt;
  if (!canDeletePrompt(current, actor)) {
    throw new Error('You do not have permission to delete this prompt');
  }

  const { error } = await supabase.from('prompts').delete().eq('id', id);
  if (error) throw promptError('Deleting prompt', error);
}

export interface PromptRealtimeEvent {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  newPrompt: SavedPrompt | null;
  oldPrompt: Partial<SavedPrompt> | null;
}

export function subscribeToPrompts(
  callback: (event: PromptRealtimeEvent) => void,
  onStatus?: (status: string) => void
) {
  try {
    const channel = supabase
      .channel(`public:prompts:${globalThis.crypto?.randomUUID?.() || Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'prompts' }, (payload) => {
        callback({
          eventType: payload.eventType as PromptRealtimeEvent['eventType'],
          newPrompt:
            payload.eventType === 'DELETE' ? null : payload.new as SavedPrompt,
          oldPrompt: payload.old as Partial<SavedPrompt>,
        });
      })
      .subscribe((status) => onStatus?.(status));

    return () => {
      void supabase.removeChannel(channel);
    };
  } catch {
    return () => {};
  }
}
