import { useCallback, useRef, useState } from 'react';
import { TaskConflictError, updateTask as apiUpdateTask } from '../../../api/tasks';
import { useAppStore, useAuthStore, useLanguageStore, useToastStore } from '../../../store';
import type { Task } from '../../../types';
import { canUndo, undoPatch } from '../../../workflow';

export interface ApplyOptions {
  /** Already-translated success message. */
  success?: string;
  /** Already-translated failure message. */
  error?: string;
  /**
   * Translated label for an Undo button on the success toast. Only shown when
   * putting the task back is a legal move for this user, so Undo never offers
   * something the database would refuse.
   */
  undoLabel?: string;
  /**
   * Version token to guard against. Defaults to the task's current `updated`;
   * a draft save passes the version its edits started from instead.
   */
  expectedUpdated?: string;
}

/**
 * The one path that writes to a task.
 *
 * Every call carries an optimistic-concurrency guard, so notes, payments and
 * reassignment get the same protection status changes always had — previously
 * those wrote blind and the last device to save won.
 */
export function useTaskActions(task: Task, onTaskGone?: () => void) {
  const { user } = useAuthStore();
  const { t } = useLanguageStore();
  const { updateTask: updateTaskInStore, removeTask } = useAppStore();
  const { addToast } = useToastStore();
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  const handleConflict = useCallback(
    (error: TaskConflictError) => {
      if (error.latestTask) {
        updateTaskInStore(error.latestTask.id, error.latestTask);
      } else if (error.latestTask === null) {
        removeTask(task.id);
        onTaskGone?.();
      }
      addToast(t('tasks.conflict'), 'warning');
    },
    [addToast, onTaskGone, removeTask, t, task.id, updateTaskInStore]
  );

  const write = useCallback(
    async (
      target: Task,
      patch: Partial<Task>,
      options: ApplyOptions & { undoOf?: Task } = {}
    ): Promise<Task | null> => {
      if (savingRef.current) return null;
      savingRef.current = true;
      setSaving(true);

      try {
        const updated = await apiUpdateTask(target.id, patch, {
          expectedStatus: target.status,
          expectedAssignee: target.assigned_to,
          expectedUpdated: options.expectedUpdated ?? target.updated,
        });
        updateTaskInStore(updated.id, updated);

        const offerUndo =
          options.undoLabel && canUndo(target, updated, user)
            ? {
                label: options.undoLabel,
                run: async () => {
                  // Undo against the newest version we know of, not the one we
                  // wrote — somebody else may have touched it in the meantime.
                  const latest =
                    useAppStore.getState().tasks.find((item) => item.id === updated.id) ??
                    updated;
                  await write(latest, undoPatch(target, updated), {
                    success: t('tasks.undone'),
                    error: t('tasks.undo_error'),
                  });
                },
              }
            : undefined;

        addToast(options.success ?? t('tasks.saved'), 'success', offerUndo);
        return updated;
      } catch (error) {
        if (error instanceof TaskConflictError) {
          handleConflict(error);
        } else {
          addToast(
            options.error ||
              (error instanceof Error ? error.message : t('tasks.status_update_error')),
            'error'
          );
        }
        return null;
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    },
    [addToast, handleConflict, t, updateTaskInStore, user]
  );

  const apply = useCallback(
    (patch: Partial<Task>, options: ApplyOptions = {}) => write(task, patch, options),
    [task, write]
  );

  return { apply, saving };
}

export default useTaskActions;
