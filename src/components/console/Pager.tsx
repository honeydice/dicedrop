'use client';

import { useEffect, useState, type ReactNode } from 'react';

export const PAGE_SIZE = 20;

/** Shows 20 entries at a time. The page bar appears only once a list passes 20. */
export function usePaged<T>(items: T[], resetKey = ''): { shown: T[]; pager: ReactNode } {
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  useEffect(() => setPage(1), [resetKey]);
  const current = Math.min(page, pages);
  const start = (current - 1) * PAGE_SIZE;
  const shown = items.slice(start, start + PAGE_SIZE);
  const btn = 'inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-edge bg-raised px-3 font-mono text-[13px] text-fg disabled:opacity-40';

  const pager =
    items.length > PAGE_SIZE ? (
      <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-raised px-5 py-3">
        <span className="font-mono text-[13px] text-muted">
          {start + 1}-{start + shown.length} of {items.length}
        </span>
        <span className="flex flex-wrap items-center gap-1.5">
          <button type="button" className={btn} disabled={current === 1} onClick={() => setPage(current - 1)}>
            prev
          </button>
          {Array.from({ length: pages }, (_, i) => i + 1)
            .filter((n) => n === 1 || n === pages || Math.abs(n - current) <= 2)
            .map((n, i, list) => (
              <span key={n} className="flex items-center gap-1.5">
                {i > 0 && n - list[i - 1] > 1 ? <span className="px-1 font-mono text-[13px] text-muted">…</span> : null}
                <button
                  type="button"
                  aria-current={n === current ? 'page' : undefined}
                  className={btn}
                  style={n === current ? { borderColor: 'rgb(var(--accent))', color: 'rgb(var(--strong))' } : undefined}
                  onClick={() => setPage(n)}
                >
                  {n}
                </button>
              </span>
            ))}
          <button type="button" className={btn} disabled={current === pages} onClick={() => setPage(current + 1)}>
            next
          </button>
        </span>
      </nav>
    ) : null;

  return { shown, pager };
}
