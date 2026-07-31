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
export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/** Idle time before an edit is written. Short enough that nobody has to think about saving. */
const AUTOSAVE_MS = 1200;

interface StoredDraft {
  /** The task version this draft was typed against. */
  base: string;
  fields: Draft;
}

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

/**
 * Recovers a crash draft, but only if the server has not moved on since it was
 * typed. A stored draft with a stale base is somebody else's newer work being
 * shadowed by our leftovers, which is exactly how one laptop got pinned to old
 * notes forever.
 */
function readStoredDraft(task: Task): Draft | null {
  try {
    const raw = window.sessionStorage.getItem(storageKey(task.id));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredDraft>;
    if (!parsed?.fields || parsed.base !== task.updated) {
      window.sessionStorage.removeItem(storageKey(task.id));
      return null;
    }
    return DRAFT_FIELDS.every((field) => typeof parsed.fields![field] === 'string')
      ? (parsed.fields as Draft)
      : null;
  } catch {
    return null;
  }
}

function writeStoredDraft(taskId: string, value: StoredDraft | null) {
  try {
    if (value) window.sessionStorage.setItem(storageKey(taskId), JSON.stringify(value));
    else window.sessionStorage.removeItem(storageKey(taskId));
  } catch {
    // Private-mode storage failures must not cost the user their typing.
  }
}

interface Options {
  canEdit: boolean;
  /** Persists the patch. Resolves with the stored task, or null if it failed. */
  onSave: (patch: Partial<Task>, baseUpdated: string) => Promise<Task | null>;
}

/**
 * Holds the shared submission fields while they are being edited, and writes
 * them out on its own.
 *
 * There is no Save button to forget: edits go to the server about a second
 * after typing stops, so the window in which one laptop knows something another
 * does not is about a second wide rather than however long somebody sits on an
 * unsaved form.
 */
export function useTaskDraft(task: Task, { canEdit, onSave }: Options) {
  const [draft, setDraft] = useState<Draft>(() => readStoredDraft(task) ?? draftFromTask(task));
  const [remoteChanged, setRemoteChanged] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);

  const taskIdRef = useRef(task.id);
  const baseUpdatedRef = useRef(task.updated);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const draftRef = useRef(draft);
  const onSaveRef = useRef(onSave);

  onSaveRef.current = onSave;
  draftRef.current = draft;

  const saved = useMemo(() => draftFromTask(task), [task]);
  const dirty = DRAFT_FIELDS.some((field) => draft[field] !== saved[field]);

  const patchFrom = useCallback(
    (source: Draft, against: Draft): Partial<Task> => {
      const result: Partial<Task> = {};
      for (const field of DRAFT_FIELDS) {
        if (source[field] !== against[field]) result[field] = source[field];
      }
      return result;
    },
    []
  );

  useEffect(() => {
    dirtyRef.current = dirty;
    writeStoredDraft(task.id, dirty ? { base: baseUpdatedRef.current, fields: draft } : null);
  }, [dirty, draft, task.id]);

  // Adopt whatever the server now holds unless we are actively competing with
  // it. Matching content is treated as agreement rather than a conflict, so a
  // save coming back through Realtime does not raise a false alarm.
  useEffect(() => {
    if (taskIdRef.current !== task.id) {
      taskIdRef.current = task.id;
      baseUpdatedRef.current = task.updated;
      setDraft(readStoredDraft(task) ?? draftFromTask(task));
      setRemoteChanged(false);
      setSaveState('idle');
      return;
    }

    const server = draftFromTask(task);
    const identical = DRAFT_FIELDS.every((field) => draftRef.current[field] === server[field]);

    if (identical) {
      baseUpdatedRef.current = task.updated;
      setRemoteChanged(false);
      return;
    }
    if (!dirtyRef.current) {
      baseUpdatedRef.current = task.updated;
      setDraft(server);
      setRemoteChanged(false);
    } else if (task.updated !== baseUpdatedRef.current) {
      setRemoteChanged(true);
    }
  }, [task]);

  const setField = useCallback((field: DraftField, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
  }, []);

  const markSaved = useCallback((updated: Task) => {
    baseUpdatedRef.current = updated.updated;
    dirtyRef.current = false;
    setRemoteChanged(false);
    writeStoredDraft(updated.id, null);
  }, []);

  const saveNow = useCallback(async () => {
    if (savingRef.current || !canEdit) return;
    const current = draftRef.current;
    const patch = patchFrom(current, draftFromTask(task));
    if (Object.keys(patch).length === 0) return;

    savingRef.current = true;
    setSaveState('saving');
    try {
      const updated = await onSaveRef.current(patch, baseUpdatedRef.current);
      if (updated) {
        markSaved(updated);
        setLastSavedAt(new Date().toISOString());
        setSaveState('saved');
      } else {
        setSaveState('error');
      }
    } finally {
      savingRef.current = false;
    }
  }, [canEdit, markSaved, patchFrom, task]);

  // Debounced auto-save. Restarts on every keystroke, so it fires once the
  // typing stops rather than mid-sentence.
  useEffect(() => {
    if (!canEdit || !dirty || remoteChanged) return;
    const timer = window.setTimeout(() => void saveNow(), AUTOSAVE_MS);
    return () => window.clearTimeout(timer);
  }, [canEdit, dirty, draft, remoteChanged, saveNow]);

  // Closing the tab or switching away should not sit on an unwritten edit.
  useEffect(() => {
    if (!canEdit) return;
    const flush = () => {
      if (dirtyRef.current && !savingRef.current) void saveNow();
    };
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onHide);
      flush();
    };
  }, [canEdit, saveNow]);

  /** Discards local edits in favour of what is now stored. */
  const loadLatest = useCallback(() => {
    baseUpdatedRef.current = task.updated;
    dirtyRef.current = false;
    setDraft(draftFromTask(task));
    setRemoteChanged(false);
    setSaveState('idle');
    writeStoredDraft(task.id, null);
  }, [task]);

  const patch = useCallback(
    (): Partial<Task> => patchFrom(draft, saved),
    [draft, patchFrom, saved]
  );

  return {
    draft,
    setField,
    dirty,
    remoteChanged,
    loadLatest,
    markSaved,
    patch,
    saveNow,
    saveState,
    lastSavedAt,
    /** The version the draft was started from — the optimistic-concurrency token. */
    baseUpdated: baseUpdatedRef.current,
  };
}

export default useTaskDraft;
