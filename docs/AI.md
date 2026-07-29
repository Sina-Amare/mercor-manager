# AI assistance

Three features, all optional. With no provider configured every one of them is
invisible and the app behaves exactly as it does without them.

## Why an Edge Function

AGNUS is a static site on GitHub Pages. A key in a `VITE_` variable is compiled
into the bundle and readable by anyone who loads the page — the same mistake the
old hardcoded Supabase credentials made. So the key lives in the `ai` Edge
Function, the browser sends its Supabase JWT, and the function checks the caller
is an active member before it calls anything.

## What is built

**Polish to English** — on Prompt, DSP, Final Answer, Notes and Studio Result.
The team thinks in Persian and submits in English; this is the chore that
repeats on every task. The rewrite is shown for review and never overwrites the
field on its own.

**Pre-submit check** — on the Studio stage, right before a task goes to Review.
Looks for blank fields, placeholders, and a final answer that does not address
the prompt. Advisory only: it never blocks the submit button, because a wrong
"no" here means arguing with a model about your own work.

**Prompt search by meaning** — on the prompts library, and only when substring
search finds nothing. Ranks by what a prompt is for rather than which words you
happened to remember.

## What is deliberately not built

Status routing, auto-approval, suggested payment amounts, a dashboard chatbot,
anomaly detection. On a team this size those add latency and new failure modes
to decisions whose whole value is that a person made them.

## Setup

```bash
supabase functions deploy ai
supabase secrets set GEMINI_API_KEY=...      # primary provider
supabase secrets set GLM_API_KEY=...         # optional fallback
supabase secrets set AI_DAILY_LIMIT=60       # optional, per user per day
supabase secrets set ALLOWED_ORIGINS=https://your-user.github.io
```

Apply `supabase/migrations/20260733_ai_usage.sql` for the per-user daily
counter. The free tiers in play are shared and small, so one tab stuck in a
retry loop would otherwise spend everybody's budget for the day.

Model ids are overridable with `GEMINI_MODEL` and `GLM_MODEL`; the defaults are
`gemini-flash-3.1-lite` and `glm-5.2`. If Gemini errors and a GLM key is set,
the function falls back automatically.

## Cost shape

Every call is one request with a short system prompt and a bounded input
(12k characters for a rewrite, 4k per field for a check). At 60 calls per person
per day a five-person team stays inside a 500-request daily allowance with room
to spare.
