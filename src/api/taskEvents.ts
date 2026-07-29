import { supabase } from './supabase';
import type { TaskStatus } from '../types';

export interface TaskEvent {
  id: number;
  task_id: string;
  actor_id: string | null;
  from_status: TaskStatus | null;
  to_status: TaskStatus | null;
  changed_fields: string[];
  at: string;
}

function isMissingTable(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = 'code' in error ? String(error.code) : '';
  return code === 'PGRST205' || code === '42P01';
}

/**
 * The task's own history. Returns an empty list when the audit migration has
 * not been applied yet, so the panel simply shows nothing rather than erroring.
 */
export async function fetchTaskEvents(taskId: string, limit = 50): Promise<TaskEvent[]> {
  const { data, error } = await supabase
    .from('task_events')
    .select('id,task_id,actor_id,from_status,to_status,changed_fields,at')
    .eq('task_id', taskId)
    .order('at', { ascending: false })
    .limit(limit);

  if (error) {
    if (isMissingTable(error)) return [];
    throw new Error(`Loading task history failed: ${error.message}`);
  }
  return (data || []) as TaskEvent[];
}
