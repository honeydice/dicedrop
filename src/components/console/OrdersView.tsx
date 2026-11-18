'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { money, timeAgo } from '@/lib/format';
import type { OpsOrder, OpsOrders, OrderStatus } from '@/lib/types';
import { Badge, Card, ErrorNote, field, PageHead, Tile } from './ui';
import { usePaged } from './Pager';
import { useLive, useNow } from './useLive';

const LOOK: Record<OrderStatus, { fg: string; bg: string }> = {
  pending: { fg: 'var(--st-pending-fg)', bg: 'var(--st-pending-bg)' },
  ordering: { fg: 'var(--st-ordering-fg)', bg: 'var(--st-ordering-bg)' },
  ordered: { fg: 'var(--st-ordered-fg)', bg: 'var(--st-ordered-bg)' },
  shipped: { fg: 'var(--st-shipped-fg)', bg: 'var(--st-shipped-bg)' },
  delivered: { fg: 'var(--st-delivered-fg)', bg: 'var(--st-delivered-bg)' },
  issue: { fg: 'var(--st-issue-fg)', bg: 'var(--st-issue-bg)' },
  held: { fg: 'var(--st-held-fg)', bg: 'var(--st-held-bg)' },
  cancelled: { fg: 'var(--st-cancelled-fg)', bg: 'var(--st-cancelled-bg)' },
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

type Action = 'retry' | 'hold' | 'cancel';

function allowed(o: OpsOrder, action: Action): boolean {
  if (action === 'retry') return o.status === 'issue' || o.status === 'held' || o.status === 'cancelled' || o.stuck;
  if (action === 'hold') return o.status === 'pending' || o.status === 'issue';
  return o.status !== 'shipped' && o.status !== 'delivered' && o.status !== 'cancelled';
}

function matches(o: OpsOrder, q: string): boolean {
  if (!q) return true;
  return [o.title, o.order_number, o.amazon_order_id, o.buyer_name, o.buyer_username, o.store_code, o.account_label, o.box_name, o.client_name, o.asin]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .includes(q);
}

const EMPTY: OpsOrders = {
  orders: [],
  total_orders: 0,
  spent_today: 0,
  pending_count: 0,
  pending_missing_cost: 0,
  pending_cogs: 0,
  pending_tax: 0,
  clients: [],
};

export function OrdersView({ initial, initialError }: { initial: OpsOrders | null; initialError: string }) {
  const [client, setClient] = useState('');
  const args = useMemo(() => ({ p_client: client || null }), [client]);
  const { data: raw, error, setError, refresh, supabase } = useLive<OpsOrders | null>('dd_ops_orders', args, initial, initialError, 30000);
  const data = raw ?? EMPTY;
  const now = useNow();

  const [tab, setTab] = useState<TabId>('all');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState('');
  const [busy, setBusy] = useState('');
  const [live, setLive] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Live updates: any change to any order refreshes the list.
  useEffect(() => {
    const schedule = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void refresh(), 400);
    };
    const channel = supabase
      .channel('ops-orders')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, schedule)
      .subscribe((status) => setLive(status === 'SUBSCRIBED'));
    return () => {
      if (timer.current) clearTimeout(timer.current);
      void supabase.removeChannel(channel);
    };
  }, [supabase, refresh]);

  const q = query.trim().toLowerCase();
  const searched = useMemo(() => data.orders.filter((o) => matches(o, q)), [data.orders, q]);
  const rows = useMemo(() => searched.filter((o) => tab === 'all' || o.status === tab), [searched, tab]);
  const { shown, pager } = usePaged(rows, tab);

  const act = async (order: OpsOrder, action: Action) => {
    setBusy(order.id);
    setError('');
    try {
      const { error: rpcError } = await supabase.rpc('dd_order_action', { p_order: order.id, p_action: action });
      if (rpcError) setError(rpcError.message);
      await refresh();
    } catch {
      setError('That did not go through. Try again.');
    } finally {
      setBusy('');
    }
  };

  const pendingTotal = Number(data.pending_cogs) + Number(data.pending_tax);
  const clientName = data.clients.find((c) => c.id === client)?.name;

  return (
    <>
      <PageHead title="Orders" hint={`${rows.length} shown of ${data.total_orders}${data.total_orders > data.orders.length ? ` (latest ${data.orders.length} loaded)` : ''}`}>
        <div className="flex w-full max-w-[640px] flex-1 flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-2 text-[13px] font-medium" style={{ color: live ? 'rgb(var(--good))' : 'rgb(var(--muted))' }}>
            <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full" style={{ background: live ? 'rgb(var(--good))' : 'rgb(var(--muted))' }} />
            {live ? 'Live' : 'Connecting'}
          </span>
          <div className="basis-44">
            <label htmlFor="client-filter" className="sr-only">
              Client
            </label>
            <select id="client-filter" value={client} onChange={(e) => setClient(e.target.value)} className={field}>
              <option value="">All clients</option>
              {data.clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex-1 basis-56">
            <label htmlFor="order-search" className="sr-only">
              Search orders
            </label>
            <input
              id="order-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search order #, buyer, account, box, or title"
              className={field}
            />
          </div>
        </div>
      </PageHead>

      <section aria-label="Spend" className="mb-5 flex flex-wrap gap-3">
        <Tile label="Spent today" value={money(Number(data.spent_today))} />
        <Tile
          label="Pending estimate"
          value={money(pendingTotal)}
          tone="accent"
          hint={data.pending_missing_cost > 0 ? `${data.pending_missing_cost} waiting on a price to estimate` : undefined}
        />
        <Tile label="Projected today" value={money(Number(data.spent_today) + pendingTotal)} />
      </section>

      <ErrorNote message={error} />

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
              onClick={() => setTab(t.id)}
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

      <Card
        title={`GET /orders${[tab === 'all' ? '' : `status=${tab}`, clientName ? `client=${clientName}` : ''].filter(Boolean).map((p, i) => (i === 0 ? `?${p}` : `&${p}`)).join('')}`}
        right={<Badge>{rows.length}</Badge>}
      >
        {shown.map((o) => {
          const look = LOOK[o.status] ?? LOOK.pending;
          const placed = o.buy_cost !== null && o.buy_cost !== undefined;
          const profit = o.profit === null || o.profit === undefined ? null : Number(o.profit);
          const isOpen = open === o.id;
          const fresh = now !== null && now - new Date(o.updated_at).getTime() < 60000;
          const who = [o.client_name, o.buyer_name, o.buyer_username, o.store_code].filter(Boolean).join(' · ');
          return (
            <div key={o.id} className="border-b border-divider last:border-b-0" style={fresh ? { background: look.bg } : undefined}>
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => setOpen(isOpen ? '' : o.id)}
                className="flex w-full items-start gap-3.5 bg-transparent px-5 py-3.5 text-left hover:bg-raised/60"
              >
                <span aria-hidden="true" className="mt-[7px] inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: look.fg }} />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-3 font-mono text-[15px]">
                    <span className="text-fg">order.{o.status}</span>
                    <span className="text-[13px] text-muted">{o.order_number}</span>
                    {o.account_label ? <span className="text-[13px] text-muted">{o.account_label}</span> : null}
                    {o.stuck ? <span className="text-[13px] text-warn">stuck</span> : null}
                  </span>
                  <span className="mt-1 block text-[13px] text-muted">
                    {o.title ?? o.asin ?? 'Untitled item'}
                    {o.quantity > 1 ? ` ×${o.quantity}` : ''}
                    {who ? ` · ${who}` : ''}
                  </span>
                  {o.issue_reason ? <span className="mt-1 block text-[13px] text-bad">{o.issue_reason}</span> : null}
                  {o.cancel_requested ? <span className="mt-1 block text-[13px] text-warn">cancel requested</span> : null}
                </span>
                <span className="shrink-0 text-right font-mono">
                  <span className="block text-[13px] text-muted">{now ? timeAgo(o.updated_at, now) : ' '}</span>
                  <span className="mt-1 block text-[13px] text-fg">{money(o.sale_price)}</span>
                  {placed ? (
                    <span className="block text-xs" style={{ color: profit === null ? 'rgb(var(--muted))' : profit >= 0 ? 'rgb(var(--good))' : 'rgb(var(--bad))' }}>
                      profit {money(profit)}
                    </span>
                  ) : null}
                </span>
              </button>

              {isOpen ? (
                <div className="border-t border-divider px-5 pb-4 pl-[46px] pt-3">
                  <dl className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-x-6 gap-y-2 font-mono text-xs">
                    {[
                      ['client', o.client_name],
                      ['amazon_order', o.amazon_order_id ?? 'pending'],
                      ['account', o.account_label ?? 'unassigned'],
                      ['box', o.box_name ?? '—'],
                      ['store', o.store_code ?? '—'],
                      ['asin', o.asin ?? '—'],
                      ['price', money(o.sale_price)],
                      ['fees', money(o.sale_fees)],
                      ['cost', placed ? money(o.buy_cost) : o.est_cost !== null ? `est. ${money(o.est_cost)}` : '—'],
                      ['profit', money(profit)],
                      ['tracking', o.tracking_number ?? '—'],
                      ['ship_state', o.ship_state ?? '—'],
                    ].map(([k, v]) => (
                      <div key={k}>
                        <dt className="text-muted">{k}</dt>
                        <dd className="mt-0.5 break-all text-fg">{v}</dd>
                      </div>
                    ))}
                  </dl>
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    {(['retry', 'hold', 'cancel'] as Action[]).map((a) => (
                      <button
                        key={a}
                        type="button"
                        disabled={!allowed(o, a) || busy === o.id}
                        onClick={() => void act(o, a)}
                        className={`min-h-[44px] rounded-lg border bg-raised px-4 font-mono text-[13px] disabled:cursor-not-allowed disabled:opacity-40 ${
                          a === 'cancel' ? 'border-dangerline text-bad' : 'border-edge text-fg'
                        }`}
                      >
                        {a}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}

        {rows.length === 0 ? (
          <div className="px-5 py-12 text-center font-mono text-[13px] text-muted">
            {data.orders.length === 0 ? 'no orders yet. they appear here the moment a client sends one.' : 'no orders match.'}
          </div>
        ) : null}
        {pager}
      </Card>
    </>
  );
}
