/**
 * One place for the Supabase error translation every api module used to carry
 * its own copy of: a table that has not been migrated yet reads as "not
 * configured", everything else as "<action> failed in Supabase: <message>".
 */
export function isMissingTable(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = 'code' in error ? String(error.code) : '';
  return code === 'PGRST205' || code === '42P01';
}

export function wrapSupabaseError(
  action: string,
  error: unknown,
  notConfiguredMessage?: string
): Error {
  if (notConfiguredMessage && isMissingTable(error)) {
    return new Error(notConfiguredMessage);
  }
  const message =
    error instanceof Error
      ? error.message
      : error && typeof error === 'object' && 'message' in error
        ? String(error.message)
        : 'Unknown cloud error';
  return new Error(`${action} failed in Supabase: ${message}`);
}
