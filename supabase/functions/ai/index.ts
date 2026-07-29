// ═══════════════════════════════════════════════════════════════════════════
// ai — the only place an LLM key exists.
//
// AGNUS is a static site: anything in a VITE_ variable is readable by everyone
// who loads the page. So the key lives here, the caller proves who they are
// with their Supabase JWT, and a per-user daily counter keeps one person from
// spending the whole free tier.
//
// Deploy:
//   supabase functions deploy ai
//   supabase secrets set GEMINI_API_KEY=...        # primary
//   supabase secrets set GLM_API_KEY=...           # optional fallback
//   supabase secrets set AI_DAILY_LIMIT=60         # optional, per user
//
// With no key configured the function returns 503 and every AI control in the
// interface hides itself.
// ═══════════════════════════════════════════════════════════════════════════

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { json, preflight } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') ?? '';
const GEMINI_MODEL = Deno.env.get('GEMINI_MODEL') ?? 'gemini-flash-3.1-lite';
const GLM_API_KEY = Deno.env.get('GLM_API_KEY') ?? '';
const GLM_MODEL = Deno.env.get('GLM_MODEL') ?? 'glm-5.2';
const GLM_BASE_URL =
  Deno.env.get('GLM_BASE_URL') ?? 'https://open.bigmodel.cn/api/paas/v4/chat/completions';

const DAILY_LIMIT = Number(Deno.env.get('AI_DAILY_LIMIT') ?? '60');
const MAX_INPUT_CHARS = 12000;

type Task = 'translate' | 'check' | 'search';

class RequestError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

function service(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function requireMember(request: Request, client: SupabaseClient) {
  const token = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) throw new RequestError('Sign in first', 401);

  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) throw new RequestError('Session is not valid', 401);

  const { data: profile } = await client
    .from('users')
    .select('id,is_active')
    .eq('auth_user_id', data.user.id)
    .maybeSingle();

  if (!profile?.is_active) throw new RequestError('Account is not active', 403);
  return profile.id as string;
}

// A plain per-day counter row. Enough to stop one tab in a retry loop from
// draining a shared free tier; not trying to be a billing system.
async function consumeQuota(client: SupabaseClient, userId: string) {
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await client
    .from('ai_usage')
    .select('calls')
    .eq('user_id', userId)
    .eq('day', today)
    .maybeSingle();

  const calls = (data?.calls as number | undefined) ?? 0;
  if (calls >= DAILY_LIMIT) {
    throw new RequestError('You have reached today’s AI limit. Try again tomorrow.', 429);
  }

  await client.from('ai_usage').upsert(
    { user_id: userId, day: today, calls: calls + 1 },
    { onConflict: 'user_id,day' }
  );
}

// ─── Prompts ─────────────────────────────────────────────────────────────────

const SYSTEM_PROMPTS: Record<Task, string> = {
  translate: [
    'You rewrite text for a Mercor red-teaming submission.',
    'Return clear, natural, professional English.',
    'Preserve every technical detail, identifier, code block and number exactly.',
    'Do not add, remove, summarise or explain anything.',
    'If the input is already English, only fix grammar and clarity.',
    'Return the rewritten text and nothing else — no preamble, no quotes.',
  ].join(' '),

  check: [
    'You review a Mercor task submission before a human sends it for review.',
    'You are advisory only; the human decides.',
    'Report only concrete, checkable problems: an empty or placeholder field,',
    'a final answer that does not address the prompt, a DSP unrelated to the prompt,',
    'or text that is obviously unfinished.',
    'Do not comment on style, tone or wording. Do not invent problems.',
    'Reply with a JSON array of at most 4 objects: [{"field":"prompt|dsp|final_answer|notes","issue":"one short sentence"}].',
    'Reply with [] when nothing is wrong. Output JSON only.',
  ].join(' '),

  search: [
    'You rank saved prompts against a search query by meaning, not keywords.',
    'Reply with a JSON array of the matching ids, best first, at most 10:',
    '["id1","id2"]. Include only genuinely relevant ones. Output JSON only.',
  ].join(' '),
};

async function callGemini(system: string, user: string): Promise<string> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 2048 },
      }),
    }
  );

  if (!response.ok) throw new Error(`Gemini responded ${response.status}`);
  const body = await response.json();
  const text = body?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('');
  if (!text) throw new Error('Gemini returned nothing usable');
  return text as string;
}

async function callGlm(system: string, user: string): Promise<string> {
  const response = await fetch(GLM_BASE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${GLM_API_KEY}`,
    },
    body: JSON.stringify({
      model: GLM_MODEL,
      temperature: 0.2,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });

  if (!response.ok) throw new Error(`GLM responded ${response.status}`);
  const body = await response.json();
  const text = body?.choices?.[0]?.message?.content;
  if (!text) throw new Error('GLM returned nothing usable');
  return text as string;
}

async function generate(system: string, user: string): Promise<string> {
  if (GEMINI_API_KEY) {
    try {
      return await callGemini(system, user);
    } catch (error) {
      if (!GLM_API_KEY) throw error;
      console.error('Gemini failed, falling back to GLM:', error);
    }
  }
  if (GLM_API_KEY) return callGlm(system, user);
  throw new RequestError('No AI provider is configured', 503);
}

/** Models like to wrap JSON in a fenced block however firmly you ask them not to. */
function parseJsonArray(text: string): unknown[] {
  const cleaned = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (!match) return [];
    try {
      const parsed = JSON.parse(match[0]);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
}

// ─── Entry point ─────────────────────────────────────────────────────────────

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;

  if (request.method !== 'POST') return json(request, { error: 'Use POST' }, 405);

  if (!GEMINI_API_KEY && !GLM_API_KEY) {
    return json(request, { error: 'AI is not configured' }, 503);
  }

  const client = service();

  try {
    const userId = await requireMember(request, client);
    const payload = (await request.json()) as Record<string, unknown>;
    const task = String(payload.task ?? '') as Task;

    if (!SYSTEM_PROMPTS[task]) {
      return json(request, { error: `Unknown task "${task}"` }, 400);
    }

    const input = String(payload.text ?? '').slice(0, MAX_INPUT_CHARS);

    // Empty input is how the client probes whether AI is configured at all.
    // It reaches no model, so it must not spend a quota unit either.
    if (task === 'translate' && !input.trim()) return json(request, { text: '' });

    await consumeQuota(client, userId);

    if (task === 'translate') {
      return json(request, { text: (await generate(SYSTEM_PROMPTS.translate, input)).trim() });
    }

    if (task === 'check') {
      const fields = {
        prompt: String(payload.prompt ?? '').slice(0, 4000),
        dsp: String(payload.dsp ?? '').slice(0, 4000),
        final_answer: String(payload.final_answer ?? '').slice(0, 4000),
        notes: String(payload.notes ?? '').slice(0, 2000),
      };
      const text = await generate(SYSTEM_PROMPTS.check, JSON.stringify(fields));
      return json(request, { issues: parseJsonArray(text).slice(0, 4) });
    }

    // search
    const query = String(payload.query ?? '').slice(0, 500);
    const candidates = (Array.isArray(payload.prompts) ? payload.prompts : [])
      .slice(0, 100)
      .map((item) => {
        const entry = item as Record<string, unknown>;
        return {
          id: String(entry.id ?? ''),
          title: String(entry.title ?? '').slice(0, 200),
          body: String(entry.body ?? '').slice(0, 600),
        };
      });

    if (!query.trim() || candidates.length === 0) return json(request, { ids: [] });

    const text = await generate(
      SYSTEM_PROMPTS.search,
      JSON.stringify({ query, prompts: candidates })
    );
    return json(request, { ids: parseJsonArray(text).map(String).slice(0, 10) });
  } catch (error) {
    const status = error instanceof RequestError ? error.status : 500;
    const message = error instanceof Error ? error.message : 'Unexpected error';
    return json(request, { error: message }, status);
  }
});
