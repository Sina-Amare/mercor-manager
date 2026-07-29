import { supabase, SUPABASE_FUNCTIONS_URL } from './supabase';

// The key lives in the `ai` Edge Function, never in the bundle. When the
// function is not deployed or has no provider configured, `aiAvailable` stays
// false and every AI control in the interface hides itself.

export interface SubmissionIssue {
  field: 'prompt' | 'dsp' | 'final_answer' | 'notes';
  issue: string;
}

let availability: boolean | null = null;

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Sign in again to use AI assistance');

  const response = await fetch(`${SUPABASE_FUNCTIONS_URL}/ai`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const payload = (await response.json().catch(() => ({}))) as { error?: string } & T;

  if (response.status === 503 || response.status === 404) {
    availability = false;
    throw new Error('AI assistance is not configured');
  }
  if (!response.ok) throw new Error(payload?.error || 'AI assistance failed');

  availability = true;
  return payload;
}

/**
 * Cheap probe so the UI can decide whether to render AI controls at all.
 *
 * Fails closed: only a successful probe counts as available. Treating anything
 * that is not literally "not configured" as working meant an expired token or a
 * gateway 401 would leave the AI buttons on screen, failing on every click.
 * A button that is not there beats a button that does not work.
 */
export async function checkAiAvailable(): Promise<boolean> {
  if (availability !== null) return availability;
  try {
    await call<{ text: string }>({ task: 'translate', text: '' });
    availability = true;
  } catch {
    availability = false;
  }
  return availability;
}

/** Rewrites a field into clear English. The result is always shown for review. */
export async function polishToEnglish(text: string): Promise<string> {
  const result = await call<{ text: string }>({ task: 'translate', text });
  return result.text ?? '';
}

/** Advisory pre-submit check. Never blocks; an empty list means "nothing found". */
export async function checkSubmission(fields: {
  prompt: string;
  dsp: string;
  final_answer: string;
  notes: string;
}): Promise<SubmissionIssue[]> {
  const result = await call<{ issues: SubmissionIssue[] }>({ task: 'check', ...fields });
  return (result.issues ?? []).filter(
    (issue) => issue && typeof issue.issue === 'string' && issue.issue.trim().length > 0
  );
}

/** Ranks saved prompts by meaning when substring search comes up short. */
export async function searchPrompts(
  query: string,
  prompts: { id: string; title: string; body: string }[]
): Promise<string[]> {
  const result = await call<{ ids: string[] }>({ task: 'search', query, prompts });
  return result.ids ?? [];
}
