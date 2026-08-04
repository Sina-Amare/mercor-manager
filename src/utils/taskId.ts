/**
 * Pulls the Mercor task ID out of pasted task content.
 *
 * The whole task page gets pasted into the body — the ID is already in there,
 * usually on a "Task ID:" line at the top, so retyping it by hand is pure
 * transcription work with a real chance of a typo.
 *
 * Ordering matters. The pasted text can mention several IDs (source links,
 * seed references, model transcripts), so a labelled ID always wins over a bare
 * one, and a canonical 32-hex ID wins over a looser match.
 */

/** Mercor IDs are `task_` plus 32 lowercase hex characters. */
const CANONICAL = /\btask_[0-9a-f]{32}\b/i;
const CANONICAL_ALL = /\btask_[0-9a-f]{32}\b/gi;

/** Explicitly labelled, e.g. "Task ID: task_abc…" — allows any id shape. */
const LABELLED = /task\s*id\s*[:#-]?\s*(task_[A-Za-z0-9_-]{6,})/i;

/** Last resort: anything that looks like an id at all. */
const LOOSE = /\btask_[A-Za-z0-9]{6,}\b/;

export interface DetectedTaskId {
  id: string;
  /** How it was found, for wording the hint shown to the user. */
  source: 'labelled' | 'canonical' | 'loose';
  /** Distinct canonical IDs present, so ambiguity can be flagged. */
  candidates: number;
}

export function detectTaskId(text: string): DetectedTaskId | null {
  if (!text || typeof text !== 'string') return null;

  const distinct = new Set(
    (text.match(CANONICAL_ALL) ?? []).map((value) => value.toLowerCase())
  );
  const candidates = distinct.size;

  const labelled = LABELLED.exec(text);
  if (labelled?.[1]) {
    return { id: labelled[1].trim(), source: 'labelled', candidates: Math.max(candidates, 1) };
  }

  const canonical = CANONICAL.exec(text);
  if (canonical?.[0]) {
    return { id: canonical[0].trim(), source: 'canonical', candidates };
  }

  const loose = LOOSE.exec(text);
  if (loose?.[0]) {
    return { id: loose[0].trim(), source: 'loose', candidates: Math.max(candidates, 1) };
  }

  return null;
}

/**
 * Cleans a value typed or pasted straight into the Task ID field. Pasting the
 * whole task blob in there should still end up with just the ID.
 */
export function normalizeTaskIdInput(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  // A single token is already an ID; only reach for the parser on longer text.
  if (!/\s/.test(trimmed)) return trimmed;
  return detectTaskId(trimmed)?.id ?? trimmed;
}
