'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { money, timeAgo } from '@/lib/format';
import type { OpsOrder, OpsOrders, OrderStatus } from '@/lib/types';
import { Badge, btn, btnAccent, Card, ErrorNote, field, label, PageHead, Tile } from './ui';
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

/** Solid status colors for the row label: pink pending, yellow ordering, blue ordered, green delivered. */
const PILL: Record<string, { bg: string; fg: string }> = {
  pending: { bg: '#f9a8d4', fg: '#500724' },
  ordering: { bg: '#fde047', fg: '#422006' },
  ordered: { bg: '#60a5fa', fg: '#0b1f44' },
  shipped: { bg: '#c4b5fd', fg: '#2e1065' },
  delivered: { bg: '#4ade80', fg: '#052e16' },
  issue: { bg: '#dc2626', fg: '#ffffff' },
  held: { bg: '#cbd5e1', fg: '#1e293b' },
  cancelled: { bg: '#94a3b8', fg: '#0f172a' },
};

const TABS: { id: TabId; label: string; dot: string }[] = [
  { id: 'all', label: 'All', dot: 'var(--st-all-fg)' },
  { id: 'pending', label: 'Pending', dot: PILL.pending.bg },
  { id: 'ordering', label: 'Ordering', dot: PILL.ordering.bg },
  { id: 'ordered', label: 'Ordered', dot: PILL.ordered.bg },
  { id: 'shipped', label: 'Shipped', dot: PILL.shipped.bg },
  { id: 'delivered', label: 'Delivered', dot: PILL.delivered.bg },
  { id: 'issue', label: 'Issues', dot: PILL.issue.bg },
];

type Action = 'retry' | 'hold' | 'cancel';

function allowed(o: OpsOrder, action: Action): boolean {
  if (action === 'retry') return o.status === 'issue' || o.status === 'held' || o.status === 'cancelled' || o.stuck;
  if (action === 'hold') return o.status === 'pending' || o.status === 'issue';
  return o.status !== 'shipped' && o.status !== 'delivered' && o.status !== 'cancelled';
}

function matches(o: OpsOrder, q: string): boolean {
  if (!q) return true;
  return [o.title, o.dd_number, o.order_number, o.amazon_order_id, o.buyer_name, o.buyer_username, o.store_code, o.account_label, o.box_name, o.client_name, o.asin]
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

/** Amazon words its estimate as "Arriving December 10 - December 21". Keep just the date part. */
function expected(estimate: string): string {
  return estimate.replace(/^(Arriving|Now expected|Expected|Delivery estimate)\s*(by\s+)?:?\s*/i, '').trim() || estimate;
}

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
  const [testOpen, setTestOpen] = useState(false);
  const [checked, setChecked] = useState('');
  const [test, setTest] = useState({ item: '', quantity: '1', ship_name: '', ship_line1: '', ship_line2: '', ship_city: '', ship_state: '', ship_postal: '', ship_phone: '', gift: 'true', gift_from: '', gift_message: '' });
  const [shot, setShot] = useState<{ title: string; taken_at: string; note: string | null; image: string } | null>(null);

  const rpc = async (id: string, fn: string, args: Record<string, unknown>): Promise<unknown | null> => {
    setBusy(id);
    setError('');
    try {
      const { data: result, error: rpcError } = await supabase.rpc(fn, args);
      if (rpcError) {
        setError(rpcError.message);
        return null;
      }
      await refresh();
      return result ?? true;
    } catch {
      setError('That did not go through. Try again.');
      return null;
    } finally {
      setBusy('');
    }
  };
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

      <div className="mb-4">
        <button type="button" className={btn} onClick={() => setTestOpen(!testOpen)}>
          {testOpen ? 'Close test order' : 'New test order'}
        </button>
        <button
          type="button"
          disabled={busy === 'check'}
          className={`${btn} ml-2`}
          onClick={async () => {
            const n = await rpc('check', 'dd_ops_check_orders_now', {});
            if (n !== null) setChecked(typeof n === 'number' && n > 0 ? `checking ${n} account${n === 1 ? '' : 's'} on Amazon now` : 'no placed orders are waiting on Amazon');
          }}
        >
          Check Amazon now
        </button>
        {checked ? <span className="ml-3 font-mono text-xs text-muted">{checked}</span> : null}
      </div>

      {testOpen ? (
        <div className="mb-5">
          <Card title="POST /orders (test)">
            <form
              className="grid gap-3 px-5 py-4 sm:grid-cols-6"
              autoComplete="off"
              onSubmit={async (e) => {
                e.preventDefault();
                const ok = await rpc('new', 'dd_ops_create_test_order', { p: { ...test, gift: test.gift_message.trim() ? 'true' : 'false' } });
                if (ok) {
                  setTest({ item: '', quantity: '1', ship_name: '', ship_line1: '', ship_line2: '', ship_city: '', ship_state: '', ship_postal: '', ship_phone: '', gift: 'true', gift_from: '', gift_message: '' });
                  setTestOpen(false);
                  setTab('all');
                }
              }}
            >
              {(
                [
                  ['item', 'Amazon link or ASIN', 'sm:col-span-5', 'https://www.amazon.com/dp/B0XXXXXXXX'],
                  ['quantity', 'Qty', 'sm:col-span-1', '1'],
                  ['ship_name', 'Buyer full name', 'sm:col-span-3', ''],
                  ['ship_phone', 'Phone (optional)', 'sm:col-span-3', ''],
                  ['ship_line1', 'Address line 1', 'sm:col-span-4', ''],
                  ['ship_line2', 'Apt / unit (optional)', 'sm:col-span-2', ''],
                  ['ship_city', 'City', 'sm:col-span-3', ''],
                  ['ship_state', 'State (2 letters)', 'sm:col-span-1', 'TX'],
                  ['ship_postal', 'Zip', 'sm:col-span-2', ''],
                  ['gift_from', 'Gift from (blank = not a gift)', 'sm:col-span-2', 'DiceDrop'],
                  ['gift_message', 'Gift message', 'sm:col-span-4', ''],
                ] as const
              ).map(([key, text, span, hint]) => (
                <div key={key} className={span}>
                  <label htmlFor={`t-${key}`} className={label}>
                    {text}
                  </label>
                  <input
                    id={`t-${key}`}
                    value={test[key]}
                    placeholder={hint}
                    maxLength={key === 'ship_state' ? 2 : key === 'item' ? 400 : key === 'gift_message' ? 240 : 80}
                    onChange={(e) => setTest({ ...test, [key]: e.target.value })}
                    className={`${field} ${key === 'item' ? 'font-mono' : ''}`}
                  />
                </div>
              ))}
              <div className="flex items-center gap-3 sm:col-span-6">
                <button type="submit" disabled={busy === 'new'} className={btnAccent}>
                  Add to queue
                </button>
                <span className="font-mono text-xs text-muted">added as held · nothing runs until you click order now</span>
              </div>
            </form>
          </Card>
        </div>
      ) : null}

      {shot ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 sm:p-10" onMouseDown={(e) => e.target === e.currentTarget && setShot(null)}>
          <div role="dialog" aria-modal="true" aria-label={`Screenshot for ${shot.title}`} className="w-full max-w-5xl overflow-hidden rounded-2xl border border-line bg-panel">
            <div className="flex items-center justify-between gap-3 border-b border-line bg-raised px-5 py-3">
              <div className="font-mono text-[13px] text-muted">
                screenshot · {shot.title} · {new Date(shot.taken_at).toLocaleString()}
                {shot.note ? ` · ${shot.note}` : ''}
              </div>
              <button type="button" className="min-h-[44px] bg-transparent px-2 font-mono text-[13px] text-muted hover:text-fg" onClick={() => setShot(null)}>
                close
              </button>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`data:image/jpeg;base64,${shot.image}`} alt={`What the worker saw on ${shot.title}`} className="block w-full" />
          </div>
        </div>
      ) : null}

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
          const pill = PILL[o.status] ?? PILL.pending;
          const isOpen = open === o.id;
          const fresh = now !== null && now - new Date(o.updated_at).getTime() < 60000;
          const cogs = o.checkout?.items ?? null;
          const fees = o.checkout?.tax != null || o.checkout?.shipping != null ? Number(o.checkout?.tax ?? 0) + Number(o.checkout?.shipping ?? 0) : null;
          const total = o.buy_cost ?? o.checkout?.total ?? null;
          const note =
            ['ordered', 'shipped'].includes(o.status) && (o.checkout?.delivery_estimate || o.tracking_number)
              ? [o.status === 'shipped' ? [o.carrier, o.tracking_number].filter(Boolean).join(' ') : '', o.checkout?.delivery_estimate ? `expected ${expected(o.checkout.delivery_estimate)}` : '']
                  .filter(Boolean)
                  .join(' · ')
              : o.status === 'issue'
                ? (o.issue_reason ?? '')
                : o.status === 'ordering' || o.status === 'held'
                  ? (o.run_note ?? '')
                  : '';
          return (
            <div key={o.id} className="border-b border-divider last:border-b-0" style={fresh ? { background: look.bg } : undefined}>
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => setOpen(isOpen ? '' : o.id)}
                className="flex min-h-[38px] w-full items-center gap-3 bg-transparent px-4 py-1.5 text-left font-mono text-xs hover:bg-raised/60"
              >
                <span className="w-[82px] shrink-0 rounded px-2 py-[3px] text-center text-[11px] font-semibold uppercase tracking-wide" style={{ background: pill.bg, color: pill.fg }}>
                  {o.status}
                </span>
                <span className="w-[84px] shrink-0 truncate text-accent">{o.dd_number}</span>
                <span className="w-[150px] shrink-0 truncate text-fg">{o.order_number}</span>
                <span className="hidden w-[76px] shrink-0 truncate text-muted md:block">{o.account_label ?? '—'}</span>
                <span className="min-w-0 flex-1 truncate text-muted">
                  <span className="text-soft">{o.ship_name ?? o.buyer_name ?? ''}</span>
                  {o.ship_name || o.buyer_name ? ' · ' : ''}
                  {o.title ?? o.asin ?? 'Untitled item'}
                  {o.quantity > 1 ? ` ×${o.quantity}` : ''}
                  {note ? (
                    <span className="ml-2" style={{ color: o.status === 'issue' ? '#ef4444' : look.fg }}>
                      · {note}
                    </span>
                  ) : null}
                  {o.stuck ? <span className="ml-2 text-warn">· stuck</span> : null}
                  {o.cancel_requested ? <span className="ml-2 text-warn">· cancel requested</span> : null}
                </span>
                <span className="hidden shrink-0 text-right text-muted lg:block">
                  cogs <span className="text-fg">{money(cogs)}</span> · fees <span className="text-fg">{money(fees)}</span>
                </span>
                <span className="w-[92px] shrink-0 text-right text-muted">
                  total <span className="font-semibold text-fg">{money(total)}</span>
                </span>
                <span className="w-[62px] shrink-0 text-right text-muted">{now ? timeAgo(o.updated_at, now) : ' '}</span>
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
                      ['cost', o.buy_cost !== null ? money(o.buy_cost) : o.est_cost !== null ? `est. ${money(o.est_cost)}` : '—'],
                      ['tracking', o.tracking_number ?? '—'],
                      ['carrier', o.carrier ?? '—'],
                      ['ship_to', [o.ship_name, o.ship_line1, o.ship_city, o.ship_state, o.ship_postal].filter(Boolean).join(', ') || '—'],
                      ['checkout_items', o.checkout?.items != null ? money(o.checkout.items) : '—'],
                      ['checkout_shipping', o.checkout?.shipping != null ? money(o.checkout.shipping) : '—'],
                      ['checkout_tax', o.checkout?.tax != null ? money(o.checkout.tax) : '—'],
                      ['checkout_total', o.checkout?.total != null ? money(o.checkout.total) : '—'],
                      ['gift', o.checkout?.gift ?? '—'],
                      ['expected', o.checkout?.delivery_estimate ? expected(o.checkout.delivery_estimate) : '—'],
                    ].map(([k, v]) => (
                      <div key={k}>
                        <dt className="text-muted">{k}</dt>
                        <dd className="mt-0.5 break-all text-fg">{v}</dd>
                      </div>
                    ))}
                  </dl>
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={busy === o.id || !['held', 'pending', 'issue'].includes(o.status)}
                      onClick={() => void rpc(o.id, 'dd_ops_order_now', { p_order: o.id })}
                      className={btnAccent}
                      title="Cart only: adds the item and the buyer's address, opens checkout, takes a screenshot. Does not buy."
                    >
                      {o.status === 'ordering' && o.run_kind === 'cart_only' ? 'Running' : 'Order now (cart only)'}
                    </button>
                    <button
                      type="button"
                      disabled={busy === o.id || !['held', 'pending', 'issue'].includes(o.status) || Boolean(o.amazon_order_id)}
                      onClick={() => {
                        const total = o.checkout?.total != null ? ` Last checkout total: ${money(o.checkout.total)}.` : '';
                        if (!window.confirm(`Place this order for real? Amazon will charge the card on the account and ship ${o.title ?? o.asin ?? 'the item'} to ${o.ship_name ?? 'the buyer'}.${total}`)) return;
                        void rpc(o.id, 'dd_ops_order_now', { p_order: o.id, p_kind: 'place_order' });
                      }}
                      className="min-h-[44px] rounded-lg border border-dangerline bg-dangerbg px-4 text-[13px] font-semibold text-bad disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {o.status === 'ordering' && o.run_kind === 'place_order' ? 'Placing' : 'Place order (real)'}
                    </button>
                    {o.snapshot_at ? (
                      <button
                        type="button"
                        disabled={busy === o.id}
                        className={btn}
                        onClick={async () => {
                          const { data: result } = await supabase.rpc('dd_ops_order_snapshot', { p_order: o.id });
                          const r = result as { taken_at: string; note: string | null; image: string } | null;
                          if (r) setShot({ title: `${o.dd_number} · ${o.order_number}`, ...r });
                          else setError('That screenshot could not be loaded. Try again.');
                        }}
                      >
                        View screenshot
                      </button>
                    ) : null}
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
