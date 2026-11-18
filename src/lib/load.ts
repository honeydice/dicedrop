import { createClient } from '@/lib/supabase/server';

/** Server-side first load for a console page: one database function, never throws. */
export async function loadRpc<T>(fn: string, args?: Record<string, unknown>): Promise<{ data: T | null; error: string }> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase.rpc(fn, args ?? {});
    if (error) return { data: null, error: error.message };
    return { data: data as T, error: '' };
  } catch {
    return { data: null, error: 'Could not load this page. Refresh to try again.' };
  }
}
