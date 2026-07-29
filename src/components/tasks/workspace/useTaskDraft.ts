import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Task } from '../../../types';

export const DRAFT_FIELDS = [
  'submission_prompt',
  'submission_dsp',
  'submission_final_answer',
  'submission_notes',
  'studio_result',
] as const;

export type DraftField = (typeof DRAFT_FIELDS)[number];
export type Draft = Record<DraftField, string>;

function draftFromTask(task: Task): Draft {
  return {
    submission_prompt: task.submission_prompt || '',
    submission_dsp: task.submission_dsp || '',
    submission_final_answer: task.submission_final_answer || '',
    submission_notes: task.submission_notes || '',
    studio_result: task.studio_result || '',
  };
}

const storageKey = (taskId: string) => `agnus:draft:${taskId}`;

function readStoredDraft(taskId: string): Draft | null {
  try {
    const raw = window.sessionStorage.getItem(storageKey(taskId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Draft>;
    return DRAFT_FIELDS.every((field) => typeof parsed[field] === 'string')
      ? (parsed as Draft)
      : null;
  } catch {
    return null;
  }
}

function writeStoredDraft(taskId: string, draft: Draft | null) {
  try {
    if (draft) {
      window.sessionStorage.setItem(storageKey(taskId), JSON.stringify(draft));
    } else {
      window.sessionStorage.removeItem(storageKey(taskId));
    }
  } catch {
    // Private-mode storage failures must not cost the user their typing.
  }
}

/**
 * Holds the shared submission fields while they are being edited.
 *
 * Two things this protects against: losing work to a refresh or a stray
 * navigation (drafts are mirrored to sessionStorage per task), and silently
 * overwriting a colleague who saved the same task while you were typing
 * (`remoteChanged` surfaces it instead of letting last-write-win).
 */
export function useTaskDraft(task: Task) {
  const [draft, setDraft] = useState<Draft>(() => readStoredDraft(task.id) ?? draftFromTask(task));
  const [remoteChanged, setRemoteChanged] = useState(false);

  const taskIdRef = useRef(task.id);
  const baseUpdatedRef = useRef(task.updated);
  const dirtyRef = useRef(false);

  const saved = useMemo(() => draftFromTask(task), [task]);
  const dirty = DRAFT_FIELDS.some((field) => draft[field] !== saved[field]);

  useEffect(() => {
    dirtyRef.current = dirty;
    writeStoredDraft(task.id, dirty ? draft : null);
  }, [dirty, draft, task.id]);

  // A different task, or a remote change we are not competing with, adopts the
  // stored values. A remote change while dirty raises the banner instead.
  useEffect(() => {
    if (taskIdRef.current !== task.id) {
      taskIdRef.current = task.id;
      baseUpdatedRef.current = task.updated;
      setDraft(readStoredDraft(task.id) ?? draftFromTask(task));
      setRemoteChanged(false);
      return;
    }
    if (!dirtyRef.current) {
      baseUpdatedRef.current = task.updated;
      setDraft(draftFromTask(task));
      setRemoteChanged(false);
    } else if (task.updated !== baseUpdatedRef.current) {
      setRemoteChanged(true);
    }
  }, [task]);

  const setField = useCallback((field: DraftField, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
  }, []);

  /** Discards local edits in favour of what is now stored. */
  const loadLatest = useCallback(() => {
    baseUpdatedRef.current = task.updated;
    dirtyRef.current = false;
    setDraft(draftFromTask(task));
    setRemoteChanged(false);
    writeStoredDraft(task.id, null);
  }, [task]);

  const markSaved = useCallback((updated: Task) => {
    baseUpdatedRef.current = updated.updated;
    dirtyRef.current = false;
    setRemoteChanged(false);
    writeStoredDraft(updated.id, null);
  }, []);

  /** Only the fields that actually changed, so a save never touches the rest. */
  const patch = useCallback((): Partial<Task> => {
    const result: Partial<Task> = {};
    for (const field of DRAFT_FIELDS) {
      if (draft[field] !== saved[field]) result[field] = draft[field];
    }
    return result;
  }, [draft, saved]);

  return {
    draft,
    setField,
    dirty,
    remoteChanged,
    loadLatest,
    markSaved,
    patch,
    /** The version the draft was started from — the optimistic-concurrency token. */
    baseUpdated: baseUpdatedRef.current,
  };
}

export default useTaskDraft;
