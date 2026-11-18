'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

/**
 * Keeps one console page fresh: calls a single database function on a timer
 * (and on demand), so every page gets everything it needs in one call.
 */
export function useLive<T>(fn: string, args: Record<string, unknown> | undefined, initial: T, initialError = '', intervalMs = 10000) {
  const supabase = useMemo(() => createClient(), []);
  const [data, setData] = useState<T>(initial);
  const [error, setError] = useState(initialError);
  const key = JSON.stringify(args ?? {});
  const first = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const parsed = JSON.parse(key) as Record<string, unknown>;
      const { data: fresh, error: rpcError } = await supabase.rpc(fn, parsed);
      if (rpcError) {
        setError(rpcError.message);
        return;
      }
      setData(fresh as T);
      setError('');
    } catch {
      setError('Lost connection for a moment. Retrying.');
    }
  }, [supabase, fn, key]);

  useEffect(() => {
    if (first.current) first.current = false;
    else void refresh();
    const timer = setInterval(() => void refresh(), intervalMs);
    return () => clearInterval(timer);
  }, [refresh, intervalMs]);

  return { data, error, setError, refresh, supabase };
}

/** A clock that ticks every 15 seconds, for "2m ago" labels. Null until mounted. */
export function useNow(): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(tick);
  }, []);
  return now;
}
