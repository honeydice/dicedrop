'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { money, timeAgo } from '@/lib/format';
import { createClient } from '@/lib/supabase/client';
import type { BoardData, BoardOrder, OrderStatus } from '@/lib/types';

const LOOK: Record<OrderStatus, { label: string; fg: string; bg: string }> = {
  pending: { label: 'Pending', fg: 'var(--st-pending-fg)', bg: 'var(--st-pending-bg)' },
  ordering: { label: 'Ordering', fg: 'var(--st-ordering-fg)', bg: 'var(--st-ordering-bg)' },
  ordered: { label: 'Ordered', fg: 'var(--st-ordered-fg)', bg: 'var(--st-ordered-bg)' },
  shipped: { label: 'Shipped', fg: 'var(--st-shipped-fg)', bg: 'var(--st-shipped-bg)' },
  delivered: { label: 'Delivered', fg: 'var(--st-delivered-fg)', bg: 'var(--st-delivered-bg)' },
  issue: { label: 'Issue', fg: 'var(--st-issue-fg)', bg: 'var(--st-issue-bg)' },
  held: { label: 'On hold', fg: 'var(--st-held-fg)', bg: 'var(--st-held-bg)' },
  cancelled: { label: 'Cancelled', fg: 'var(--st-cancelled-fg)', bg: 'var(--st-cancelled-bg)' },
};

type TabId = 'all' | 'pending' | 'ordering' | 'ordered' | 'shipped' | 'delivered' | 'issue';

const TABS: { id: TabId; label: string; dot: string }[] = [
  { id: 'all', label: 'All', dot: 'var(--st-all-fg)' },
  { id: 'pending', label: 'Pending', dot: LOOK.pending.fg },
  { id: 'ordering', label: 'Ordering', dot: LOOK.ordering.fg },
  { id: 'ordered', label: 'Ordered', dot: LOOK.ordered.fg },
  { id: 'shipped', label: 'Shipped', dot: LOOK.shipped.fg },
  { id: 'delivered', label: 'Delivered', dot: LOOK.delivered.fg },
  { id: 'issue', label: 'Issues', dot: LOOK.issue.fg },
];

const GRID =
  'grid grid-cols-[132px_minmax(240px,2.2fr)_196px_140px_170px_92px_92px_92px_60px] items-center gap-x-4';

type Action = 'retry' | 'hold' | 'cancel';

function allowed(status: OrderStatus, action: Action): boolean {
  if (action === 'retry') return status === 'issue' || status === 'held' || status === 'cancelled';
  if (action === 'hold') return status === 'pending' || status === 'issue';
  return status !== 'shipped' && status !== 'delivered' && status !== 'cancelled';
}

function matches(o: BoardOrder, q: string): boolean {
  if (!q) return true;
  return [o.title, o.order_number, o.amazon_order_id, o.buyer_name, o.buyer_username, o.store_code, o.account_label, o.asin]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .includes(q);
}

export function Board({
  workspaceId,
  initial,
  initialError,
  canWrite,
}: {
  workspaceId: string;
  initial: BoardData;
  initialError: string;
  canWrite: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [data, setData] = useState<BoardData>(initial);
  const [tab, setTab] = useState<TabId>('all');
  const [query, setQuery] = useState('');
  const [openMenu, setOpenMenu] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState(initialError);
  const [live, setLive] = useState(false);
  const [now, setNow] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const { data: fresh, error: rpcError } = await supabase.rpc('dd_board', { p_workspace: workspaceId });
      if (rpcError) {
        setError(rpcError.message);
        return;
      }
      if (fresh) {
        setData(fresh as BoardData);
        setError('');
      }
    } catch {
      setError('Lost connection for a moment. Retrying.');
    }
  }, [supabase, workspaceId]);

  // Live updates: any change to an order refreshes the board. A 30s poll backs it up.
  useEffect(() => {
    const schedule = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void refresh(), 400);
    };
    const channel = supabase
      .channel(`orders-${workspaceId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders', filter: `workspace_id=eq.${workspaceId}` },
        schedule,
      )
      .subscribe((status) => setLive(status === 'SUBSCRIBED'));
    const poll = setInterval(() => void refresh(), 30000);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      clearInterval(poll);
      void supabase.removeChannel(channel);
    };
  }, [supabase, workspaceId, refresh]);

  // Keep the "2m ago" labels moving.
  useEffect(() => {
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(tick);
  }, []);

  const q = query.trim().toLowerCase();
  const searched = useMemo(() => data.orders.filter((o) => matches(o, q)), [data.orders, q]);
  const rows = useMemo(() => searched.filter((o) => tab === 'all' || o.status === tab), [searched, tab]);

  const act = async (order: BoardOrder, action: Action) => {
    setBusy(order.id);
    setError('');
    try {
      const { error: rpcError } = await supabase.rpc('dd_order_action', { p_order: order.id, p_action: action });
      if (rpcError) setError(rpcError.message);
      else setOpenMenu('');
      await refresh();
    } catch {
      setError('That did not go through. Try again.');
    } finally {
      setBusy('');
    }
  };

  const pendingTotal = Number(data.pending_cogs) + Number(data.pending_tax);

  return (
    <main className="mx-auto max-w-[1440px] px-5 pb-8 pt-6 sm:px-8">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-display text-[28px] font-semibold tracking-tight">Orders</h1>
            <span
              className="inline-flex items-center gap-2 text-[13px] font-medium"
              style={{ color: live ? 'rgb(var(--good))' : 'rgb(var(--muted))' }}
            >
              <span
                aria-hidden="true"
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: live ? 'rgb(var(--good))' : 'rgb(var(--muted))' }}
              />
              {live ? 'Live' : 'Connecting'}
            </span>
          </div>
          <div className="mt-1 text-[13px] text-muted">
            {rows.length} shown of {data.total_orders} orders
            {data.total_orders > data.orders.length ? ` (latest ${data.orders.length} loaded)` : ''}
          </div>
        </div>
        <div className="relative w-full max-w-[440px] flex-1 basis-80">
          <label htmlFor="order-search" className="sr-only">
            Search orders
          </label>
          <svg
            aria-hidden="true"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            className="absolute left-3.5 top-[13px] text-muted"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          <input
            id="order-search"
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpenMenu('');
            }}
            placeholder="Search order #, buyer, username, or title"
            className="h-11 w-full rounded-[10px] border border-edge bg-raised pl-[42px] pr-3.5 text-sm text-fg"
          />
        </div>
      </div>

      <section aria-label="Spend" className="mb-5 flex flex-wrap gap-3">
        <div className="flex-1 basis-64 rounded-xl border border-line bg-panel px-5 py-4">
          <div className="text-xs font-medium uppercase tracking-wider text-muted">Spent today</div>
          <div className="mt-1.5 font-display text-3xl font-semibold tracking-tight">{money(Number(data.spent_today))}</div>
        </div>
        <div className="flex-1 basis-64 rounded-xl border border-line bg-panel px-5 py-4">
          <div className="text-xs font-medium uppercase tracking-wider text-muted">Pending estimate</div>
          <div className="mt-1.5 font-display text-3xl font-semibold tracking-tight text-accent">{money(pendingTotal)}</div>
          {data.pending_missing_cost > 0 ? (
            <div className="mt-1 text-xs text-muted">{data.pending_missing_cost} waiting on a price to estimate</div>
          ) : null}
        </div>
        <div className="flex-1 basis-64 rounded-xl border border-line bg-panel px-5 py-4">
          <div className="text-xs font-medium uppercase tracking-wider text-muted">Projected today</div>
          <div className="mt-1.5 font-display text-3xl font-semibold tracking-tight">
            {money(Number(data.spent_today) + pendingTotal)}
          </div>
        </div>
      </section>

      {error ? (
        <div role="alert" className="mb-4 rounded-lg border border-dangerline bg-dangerbg px-4 py-3 text-[13px] text-bad">
          {error}
        </div>
      ) : null}

      <div role="tablist" aria-label="Order status" className="mb-4 flex flex-wrap gap-1 border-b border-line">
        {TABS.map((t) => {
          const selected = tab === t.id;
          const count = searched.filter((o) => t.id === 'all' || o.status === t.id).length;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => {
                setTab(t.id);
                setOpenMenu('');
              }}
              className="-mb-px inline-flex min-h-[44px] items-center gap-2 border-b-2 bg-transparent px-3.5 text-sm font-medium"
              style={{ borderBottomColor: selected ? 'rgb(var(--accent))' : 'transparent', color: selected ? 'rgb(var(--strong))' : 'rgb(var(--muted))' }}
            >
              <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full" style={{ background: t.dot }} />
              {t.label}
              <span className="rounded-full bg-chip px-[7px] py-0.5 font-mono text-xs text-soft">{count}</span>
            </button>
          );
        })}
      </div>

      <div className="overflow-x-auto rounded-xl border border-line bg-panel">
        <div className="min-w-[1180px]">
          <div className={`${GRID} border-b border-line px-5 py-3 text-xs font-medium uppercase tracking-wider text-muted`}>
            <div>Status</div>
            <div>Title</div>
            <div>Order #</div>
            <div>Account</div>
            <div>Buyer</div>
            <div className="text-right">Price</div>
            <div className="text-right">Fees</div>
            <div className="text-right">Profit</div>
            <div />
          </div>

          {rows.map((o) => {
            const look = LOOK[o.status] ?? LOOK.pending;
            const placed = o.buy_cost !== null && o.buy_cost !== undefined;
            const profit = o.profit === null || o.profit === undefined ? null : Number(o.profit);
            const menuOpen = openMenu === o.id;
            return (
              <div key={o.id} className="border-b border-divider last:border-b-0">
                <div className={`${GRID} min-h-[64px] px-5 py-2.5`}>
                  <div>
                    <span
                      className="inline-flex items-center gap-[7px] rounded-full px-2.5 py-1 text-xs font-semibold"
                      style={{ color: look.fg, background: look.bg }}
                    >
                      <span aria-hidden="true" className="inline-block h-[7px] w-[7px] rounded-full" style={{ background: look.fg }} />
                      {look.label}
                    </span>
                    <div className="mt-1 text-xs text-muted">{now ? timeAgo(o.updated_at, now) : ' '}</div>
                  </div>
                  <div className="min-w-0">
                    <div className="truncate font-medium">
                      {o.title ?? o.asin ?? 'Untitled item'}
                      {o.quantity > 1 ? <span className="text-muted"> ×{o.quantity}</span> : null}
                    </div>
                    {o.issue_reason ? (
                      <div className="mt-1 flex items-center gap-1.5 text-xs text-bad">
                        <svg
                          aria-hidden="true"
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M12 3l10 18H2z" />
                          <path d="M12 10v5" />
                          <path d="M12 18v.5" />
                        </svg>
                        {o.issue_reason}
                      </div>
                    ) : null}
                    {o.cancel_requested ? <div className="mt-1 text-xs text-warn">Cancel requested</div> : null}
                  </div>
                  <div className="font-mono text-xs">
                    <div>{o.order_number}</div>
                    <div className="mt-[3px] text-muted">{o.amazon_order_id ?? 'Amazon # pending'}</div>
                  </div>
                  <div>
                    <div className="font-medium">{o.store_code ?? '—'}</div>
                    <div className="mt-[3px] text-xs text-muted">{o.account_label ? `via ${o.account_label}` : 'Unassigned'}</div>
                  </div>
                  <div className="min-w-0">
                    <div className="truncate">{o.buyer_name ?? '—'}</div>
                    <div className="mt-[3px] truncate text-xs text-muted">{o.buyer_username ?? ''}</div>
                  </div>
                  <div className="text-right font-mono text-[13px]">{money(o.sale_price)}</div>
                  <div className="text-right font-mono text-[13px] text-soft">{placed ? money(o.sale_fees) : '—'}</div>
                  <div
                    className="text-right font-mono text-[13px] font-medium"
                    style={{ color: profit === null ? 'rgb(var(--muted))' : profit >= 0 ? 'rgb(var(--good))' : 'rgb(var(--bad))' }}
                  >
                    {money(profit)}
                  </div>
                  <div className="flex justify-end">
                    {canWrite ? (
                      <button
                        type="button"
                        aria-label={`Backup controls for order ${o.order_number}`}
                        aria-expanded={menuOpen}
                        onClick={() => setOpenMenu(menuOpen ? '' : o.id)}
                        className="inline-flex h-11 w-11 items-center justify-center rounded-lg bg-transparent text-muted hover:bg-raised hover:text-strong"
                      >
                        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                          <circle cx="5" cy="12" r="1.8" />
                          <circle cx="12" cy="12" r="1.8" />
                          <circle cx="19" cy="12" r="1.8" />
                        </svg>
                      </button>
                    ) : null}
                  </div>
                </div>
                {menuOpen ? (
                  <div className="flex flex-wrap items-center justify-end gap-2 px-5 pb-3">
                    <div className="mr-2 text-xs text-muted">Backup controls. Your connected app stays the main switch.</div>
                    {(['retry', 'hold', 'cancel'] as Action[]).map((a) => {
                      const ok = allowed(o.status, a) && busy !== o.id;
                      const label = a === 'retry' ? 'Retry' : a === 'hold' ? 'Hold' : 'Cancel order';
                      return (
                        <button
                          key={a}
                          type="button"
                          disabled={!ok}
                          onClick={() => void act(o, a)}
                          className={`min-h-[44px] rounded-lg border bg-raised px-4 text-[13px] font-medium disabled:cursor-not-allowed disabled:opacity-40 ${
                            a === 'cancel' ? 'border-dangerline text-bad' : 'border-edge text-fg'
                          }`}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}

          {rows.length === 0 ? (
            <div className="px-5 py-12 text-center text-muted">
              {data.orders.length === 0
                ? 'No orders yet. They will appear here the moment your connected app sends one.'
                : 'No orders match that search in this tab.'}
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}
