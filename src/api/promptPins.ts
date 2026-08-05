import { supabase } from './supabase';
import type { PromptPin } from '../types';

const FIELDS = 'user_id,prompt_id,sort_order,created';

function pinError(action: string, error: unknown) {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  if (code === 'PGRST205' || code === '42P01') {
    return new Error('Pinned prompts have not been configured in Supabase yet');
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
 * This person's pins, in their order.
 *
 * No `user_id` filter, and none is needed: the policy returns only your own
 * rows, so another member's pins cannot reach this browser to be filtered out.
 * `created` breaks ties because `sort_order` is deliberately not unique.
 */
export async function fetchPromptPins(): Promise<PromptPin[]> {
  const { data, error } = await supabase
    .from('prompt_pins')
    .select(FIELDS)
    .order('sort_order', { ascending: true })
    .order('created', { ascending: true });

  if (error) throw pinError('Loading pinned prompts', error);
  return (data || []) as PromptPin[];
}

/** Pins to the end of the list, where a new pin is least disruptive. */
export async function pinPrompt(
  userId: string,
  promptId: string,
  existing: PromptPin[]
): Promise<void> {
  const last = existing.reduce((max, pin) => Math.max(max, pin.sort_order), -1);
  const { error } = await supabase
    .from('prompt_pins')
    .insert({ user_id: userId, prompt_id: promptId, sort_order: last + 1 });

  if (error) throw pinError('Pinning the prompt', error);
}

export async function unpinPrompt(userId: string, promptId: string): Promise<void> {
  const { error } = await supabase
    .from('prompt_pins')
    .delete()
    .eq('user_id', userId)
    .eq('prompt_id', promptId);

  if (error) throw pinError('Unpinning the prompt', error);
}

/**
 * Renumbers the pins the caller asked for, and creates nothing.
 *
 * An UPDATE per row rather than one upsert, and the difference matters twice.
 *
 * An upsert cannot express "leave this alone if it is gone": a row the other
 * laptop unpinned while this tab was asleep has no conflict to resolve, so it
 * takes the INSERT branch and the unpin is silently undone. An UPDATE that
 * matches nothing is a no-op, which is exactly right.
 *
 * And an upsert is one all-or-nothing statement whose every row is checked
 * against the insert policy and the foreign key — so a single pin whose prompt
 * has just been deleted fails the whole reorder, and the move is lost. Separate
 * updates let the live rows through and quietly skip the dead one.
 */
export async function reorderPromptPins(userId: string, orderedPromptIds: string[]): Promise<void> {
  if (orderedPromptIds.length === 0) return;

  const results = await Promise.all(
    orderedPromptIds.map((promptId, index) =>
      supabase
        .from('prompt_pins')
        .update({ sort_order: index })
        .eq('user_id', userId)
        .eq('prompt_id', promptId)
    )
  );

  const failed = results.find((result) => result.error);
  if (failed?.error) throw pinError('Reordering pinned prompts', failed.error);
}

/** Pins ride the prompts channel; both drive the same refresh. */
export function subscribeToPromptPins(onChange: () => void, onStatus?: (status: string) => void) {
  try {
    const channel = supabase
      .channel(`public:prompt_pins:${globalThis.crypto?.randomUUID?.() || Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'prompt_pins' }, () =>
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
