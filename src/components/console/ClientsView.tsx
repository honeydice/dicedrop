'use client';

import { useState } from 'react';
import { createClientRecord, createKey, revokeKey, setClientStatus, type Result } from '@/app/(console)/actions';
import { money, timeAgo } from '@/lib/format';
import type { OpsClient } from '@/lib/types';
import { Badge, btn, btnAccent, btnDanger, Card, Dot, ErrorNote, field, label, PageHead, TONE, when } from './ui';
import { useLive, useNow } from './useLive';

interface Reveal {
  clientId: string;
  keyName: string;
  key: string;
  secret: string;
}

export function ClientsView({ initial, initialError, baseUrl }: { initial: OpsClient[]; initialError: string; baseUrl: string }) {
  const { data, error, setError, refresh } = useLive<OpsClient[]>('dd_ops_clients', undefined, initial, initialError, 15000);
  const now = useNow();
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [keyFor, setKeyFor] = useState('');
  const [keyName, setKeyName] = useState('');
  const [keyHook, setKeyHook] = useState('');
  const [reveal, setReveal] = useState<Reveal | null>(null);

  const run = async (work: () => Promise<Result>): Promise<Result | null> => {
    setBusy(true);
    setError('');
    try {
      const result = await work();
      if (!result.ok) setError(result.error);
      await refresh();
      return result;
    } catch {
      setError('That did not go through. Try again.');
      return null;
    } finally {
      setBusy(false);
    }
  };

  const snippet = `// Send an order to DiceDrop
const res = await fetch('${baseUrl}/api/v1/orders', {
  method: 'POST',
  headers: {
    'Authorization': \`Bearer \${process.env.DICEDROP_API_KEY}\`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    order_number: '22-15411-33373',
    line_id: '10085630888922',        // optional, for multi-item orders
    store_code: 'CA009',
    title: 'Watercolor Paint Brushes 12Pcs',
    asin: 'B0XXXXXXXX',               // or buy_url
    quantity: 1,
    sale_price: 19.99,
    sale_fees: 3.10,
    est_cost: 11.50,                  // optional, powers the pending estimate
    buyer: { name: 'Jane Buyer', username: 'jane_buyer' },
    ship_to: { name: 'Jane Buyer', line1: '100 Example St', city: 'Austin', state: 'TX', postal_code: '73301', phone: '5125550100' },
  }),
});
const { order } = await res.json();   // order.id, order.status

// GET  ${baseUrl}/api/v1/orders/{id}
// POST ${baseUrl}/api/v1/orders/{id}/cancel   (or /hold, /retry)`;

  return (
    <>
      <PageHead title="Clients" hint="Who is sending orders. A client is a name plus its API keys; clients never sign in." />
      <ErrorNote message={error} />

      <form
        className="mb-5 flex flex-wrap items-end gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          const result = await run(() => createClientRecord(newName));
          if (result?.ok) setNewName('');
        }}
      >
        <div className="flex-1 basis-64">
          <label htmlFor="client-name" className={label}>
            New client
          </label>
          <input id="client-name" value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={80} placeholder="DiceOps" className={field} />
        </div>
        <button type="submit" disabled={busy || !newName.trim()} className={btnAccent}>
          Add client
        </button>
      </form>

      {data.length === 0 ? (
        <Card>
          <div className="px-5 py-12 text-center font-mono text-[13px] text-muted">no clients yet. add one above, then create its API key.</div>
        </Card>
      ) : null}

      <div className="space-y-5">
        {data.map((c) => (
          <Card
            key={c.id}
            title={`client/${c.name.toLowerCase().replace(/\s+/g, '-')}`}
            right={<Badge>{c.orders_24h} / 24h</Badge>}
          >
            <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
              <div className="flex items-center gap-3">
                <Dot color={c.status === 'active' ? TONE.good : TONE.warn} />
                <div>
                  <div className="font-medium">{c.name}</div>
                  <div className="mt-0.5 font-mono text-xs text-muted">
                    {c.status} · {c.orders_total} orders · last {c.last_order_at && now ? timeAgo(c.last_order_at, now) : 'never'}
                  </div>
                </div>
              </div>
              <dl className="flex flex-wrap gap-x-8 gap-y-2 font-mono text-xs">
                <div>
                  <dt className="text-muted">pending</dt>
                  <dd className="mt-0.5 text-fg">{c.pending}</dd>
                </div>
                <div>
                  <dt className="text-muted">issues</dt>
                  <dd className="mt-0.5" style={{ color: c.issues > 0 ? TONE.bad : undefined }}>
                    {c.issues}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted">spent_today</dt>
                  <dd className="mt-0.5 text-fg">{money(Number(c.spent_today))}</dd>
                </div>
              </dl>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  className={btn}
                  onClick={() => void run(() => setClientStatus(c.id, c.status === 'active' ? 'paused' : 'active'))}
                >
                  {c.status === 'active' ? 'Pause' : 'Resume'}
                </button>
                <button
                  type="button"
                  className={btn}
                  onClick={() => {
                    setKeyFor(keyFor === c.id ? '' : c.id);
                    setKeyName('');
                    setKeyHook('');
                  }}
                >
                  New API key
                </button>
              </div>
            </div>

            {keyFor === c.id ? (
              <form
                className="flex flex-wrap items-end gap-3 border-t border-divider px-5 py-4"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const result = await run(() => createKey(c.id, keyName, keyHook));
                  if (result?.ok && result.secret) {
                    setReveal({ clientId: c.id, keyName, key: result.secret, secret: result.secret2 ?? '' });
                    setKeyFor('');
                  }
                }}
              >
                <div className="flex-1 basis-44">
                  <label htmlFor={`key-name-${c.id}`} className={label}>
                    Key name
                  </label>
                  <input id={`key-name-${c.id}`} value={keyName} onChange={(e) => setKeyName(e.target.value)} maxLength={60} placeholder="DiceOps production" className={field} />
                </div>
                <div className="flex-[2] basis-72">
                  <label htmlFor={`key-hook-${c.id}`} className={label}>
                    Webhook URL (optional)
                  </label>
                  <input id={`key-hook-${c.id}`} type="url" value={keyHook} onChange={(e) => setKeyHook(e.target.value)} placeholder="https://your-app.com/api/dicedrop/webhook" className={field} />
                </div>
                <button type="submit" disabled={busy || !keyName.trim()} className={btnAccent}>
                  Create key
                </button>
              </form>
            ) : null}

            {reveal && reveal.clientId === c.id ? (
              <div role="status" className="border-t border-divider bg-raised px-5 py-4">
                <div className="font-medium">Key created: {reveal.keyName}. Copy it now; it is shown only once.</div>
                <div className="mt-3 text-xs uppercase tracking-wider text-muted">API key</div>
                <code className="mt-1 block break-all font-mono text-[13px] text-accent">{reveal.key}</code>
                <div className="mt-3 text-xs uppercase tracking-wider text-muted">Webhook signing secret</div>
                <code className="mt-1 block break-all font-mono text-[13px] text-soft">{reveal.secret}</code>
                <button type="button" className={`${btn} mt-4`} onClick={() => setReveal(null)}>
                  I have copied it
                </button>
              </div>
            ) : null}

            {c.keys.length === 0 ? (
              <div className="border-t border-divider px-5 py-4 font-mono text-[13px] text-muted">no api keys yet.</div>
            ) : (
              c.keys.map((k) => (
                <div key={k.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-divider px-5 py-3">
                  <div className="flex items-start gap-3.5">
                    <span className="mt-[7px]">
                      <Dot color={k.revoked_at ? TONE.muted : TONE.good} />
                    </span>
                    <div>
                      <div className="flex flex-wrap items-baseline gap-x-3 font-mono text-[14px]">
                        <span>{k.revoked_at ? 'key.off' : 'key.active'}</span>
                        <span className="text-[13px] text-muted">{k.key_prefix}…</span>
                      </div>
                      <div className="mt-0.5 text-[13px] text-muted">
                        {k.name} · {k.orders_24h} orders in 24h · last used {when(k.last_used_at)}
                      </div>
                    </div>
                  </div>
                  {k.revoked_at ? null : (
                    <button type="button" disabled={busy} className={btnDanger} onClick={() => void run(() => revokeKey(k.id))}>
                      Switch off
                    </button>
                  )}
                </div>
              ))
            )}
          </Card>
        ))}
      </div>

      <details className="mt-5 rounded-2xl border border-line bg-panel">
        <summary className="min-h-[44px] cursor-pointer px-5 py-3 font-mono text-[13px] text-muted">how a client connects</summary>
        <pre className="overflow-x-auto border-t border-line bg-ink p-4 font-mono text-xs leading-relaxed text-soft">{snippet}</pre>
      </details>
    </>
  );
}
