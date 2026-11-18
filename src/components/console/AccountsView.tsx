'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { updateAccount, type AccountPatch, type Result } from '@/app/(console)/actions';
import { cardLabel, money, timeAgo } from '@/lib/format';
import type { AccountStatus, OpsAccount, OpsAccounts } from '@/lib/types';
import { Badge, btn, btnAccent, Card, Dot, ErrorNote, field, label, PageHead, sessionLabel, sessionTone, Tile, TONE } from './ui';
import { usePaged } from './Pager';
import { useLive, useNow } from './useLive';
import { AccountModal } from './AccountModal';

type Filter = 'all' | 'ready' | 'attention' | 'paused' | 'unassigned';

function needsAttention(a: OpsAccount): boolean {
  return a.status === 'locked' || a.session_state === 'needs_sign_in' || a.session_state === 'verification' || a.session_state === 'locked';
}

function isReady(a: OpsAccount): boolean {
  return (a.status === 'active' || a.status === 'warming') && (a.session_state === 'signed_in' || a.session_state === 'unknown') && a.box_online === true;
}

function tone(a: OpsAccount): string {
  if (needsAttention(a)) return a.status === 'locked' || a.session_state === 'locked' ? TONE.bad : TONE.warn;
  if (a.status === 'paused') return TONE.muted;
  if (isReady(a)) return TONE.good;
  return TONE.muted;
}


export function AccountsView({ initial, initialError }: { initial: OpsAccounts; initialError: string }) {
  const { data, error, setError, refresh } = useLive<OpsAccounts>('dd_ops_accounts', undefined, initial, initialError);
  const now = useNow();
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState('');
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState('');
  const [capDraft, setCapDraft] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState('');
  const [syncing, setSyncing] = useState(false);
  const syncNow = async () => {
    setSyncing(true);
    try {
      await refresh();
    } finally {
      setTimeout(() => setSyncing(false), 400);
    }
  };

  // Two-step codes rotate every 30 seconds. Count down locally and fetch fresh codes the moment they turn over.
  const fetchedAt = useRef(Date.now());
  const [left, setLeft] = useState(data.totp_expires_in ?? 30);
  useEffect(() => {
    fetchedAt.current = Date.now();
    setLeft(data.totp_expires_in ?? 30);
  }, [data]);
  useEffect(() => {
    const tick = setInterval(() => {
      const remaining = (data.totp_expires_in ?? 30) - Math.floor((Date.now() - fetchedAt.current) / 1000);
      setLeft(Math.max(0, remaining));
      if (remaining <= 0 && Date.now() - fetchedAt.current < 40000) void refresh();
    }, 1000);
    return () => clearInterval(tick);
  }, [data.totp_expires_in, refresh]);

  const copyCode = async (a: OpsAccount) => {
    if (!a.totp_code) return;
    try {
      await navigator.clipboard.writeText(a.totp_code);
      setCopied(a.id);
      setTimeout(() => setCopied(''), 1500);
    } catch {
      // Clipboard is unavailable; the code is still on screen to type by hand.
    }
  };

  const run = async (work: () => Promise<Result>): Promise<boolean> => {
    setBusy(true);
    setError('');
    try {
      const result = await work();
      if (!result.ok) setError(result.error);
      await refresh();
      return result.ok;
    } catch {
      setError('That did not go through. Try again.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const patch = (id: string, p: AccountPatch) => run(() => updateAccount(id, p));

  const counts = useMemo(
    () => ({
      all: data.accounts.length,
      ready: data.accounts.filter(isReady).length,
      attention: data.accounts.filter(needsAttention).length,
      paused: data.accounts.filter((a) => a.status === 'paused').length,
      unassigned: data.accounts.filter((a) => !a.box_id).length,
    }),
    [data.accounts],
  );

  const rows = data.accounts.filter((a) => {
    if (filter === 'ready') return isReady(a);
    if (filter === 'attention') return needsAttention(a);
    if (filter === 'paused') return a.status === 'paused';
    if (filter === 'unassigned') return !a.box_id;
    return true;
  });

  const { shown, pager } = usePaged(rows, filter);
  const ordersToday = data.accounts.reduce((sum, a) => sum + Number(a.orders_today), 0);
  const capacity = data.accounts.filter((a) => a.status === 'active' || a.status === 'warming').reduce((sum, a) => sum + Number(a.daily_order_cap), 0);

  return (
    <>
      <PageHead title="Accounts" hint="The Amazon account library. Every account belongs to the platform and places orders for any client.">
        <button type="button" className={btnAccent} onClick={() => setAdding(true)}>
          Add account
        </button>
      </PageHead>
      <ErrorNote message={error} />

      {adding || editId ? (
        <AccountModal
          key={editId || 'new'}
          account={data.accounts.find((x) => x.id === editId) ?? null}
          data={data}
          onClose={() => {
            setAdding(false);
            setEditId('');
          }}
          onSaved={() => {
            setAdding(false);
            setEditId('');
            void refresh();
          }}
        />
      ) : null}

      <section aria-label="Account health" className="mb-5 flex flex-wrap gap-3">
        <Tile label="Ready" value={`${counts.ready} / ${counts.all}`} tone={counts.ready > 0 ? 'good' : undefined} hint="signed in on an online box" />
        <Tile label="Need attention" value={String(counts.attention)} tone={counts.attention > 0 ? 'warn' : undefined} hint="sign-in, verification, or locked" />
        <Tile label="Orders today" value={`${ordersToday} / ${capacity}`} hint="placed against total daily capacity" />
      </section>

      <div role="tablist" aria-label="Account filter" className="mb-4 flex flex-wrap gap-1 border-b border-line">
        {(['all', 'ready', 'attention', 'paused', 'unassigned'] as Filter[]).map((f) => (
          <button
            key={f}
            type="button"
            role="tab"
            aria-selected={filter === f}
            onClick={() => setFilter(f)}
            className="-mb-px inline-flex min-h-[44px] items-center gap-2 border-b-2 bg-transparent px-3.5 text-sm font-medium capitalize"
            style={{ borderBottomColor: filter === f ? 'rgb(var(--accent))' : 'transparent', color: filter === f ? 'rgb(var(--strong))' : 'rgb(var(--muted))' }}
          >
            {f === 'attention' ? 'Needs attention' : f}
            <span className="rounded-full bg-chip px-[7px] py-0.5 font-mono text-xs text-soft">{counts[f]}</span>
          </button>
        ))}
      </div>

      <Card title={`GET /accounts${filter === 'all' ? '' : `?filter=${filter}`}`} right={<Badge>{rows.length}</Badge>}>
        {shown.map((a) => {
          const isOpen = open === a.id;
          const full = Number(a.orders_today) >= Number(a.daily_order_cap);
          const connected = a.box_online === true && a.status !== 'paused' && !needsAttention(a);
          return (
            <div key={a.id} className="border-b border-divider last:border-b-0">
              <div className="flex items-center">
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setOpen(isOpen ? '' : a.id)}
                  className="flex min-w-0 flex-1 flex-wrap items-center gap-x-8 gap-y-1 bg-transparent px-6 py-4 text-left hover:bg-raised/60"
                >
                  <span className="flex min-w-[220px] items-center gap-3.5">
                    <Dot color={connected ? TONE.good : TONE.bad} />
                    <span className="font-mono text-[16px] text-fg">{a.label}</span>
                    <span className="font-mono text-[13px]" style={{ color: connected ? TONE.good : TONE.bad }}>
                      {a.status === 'paused' ? 'paused' : a.status === 'locked' ? 'locked' : connected ? 'connected' : 'not connected'}
                    </span>
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-muted">
                    {[a.login_email, a.box_name ?? 'no VPS', a.visibility === 'private' ? `private · ${a.allowed_names.join(', ') || 'no clients'}` : 'public'].filter(Boolean).join('  ·  ')}
                    {a.last_error ? <span className="ml-3 text-bad">{a.last_error}</span> : null}
                    {a.current_order ? <span className="ml-3 font-mono">placing {a.current_order}</span> : null}
                  </span>
                  <span className="shrink-0 font-mono text-[13px]" style={{ color: full ? TONE.warn : undefined }}>
                    {a.orders_today} / {a.daily_order_cap} today
                  </span>
                </button>
                <div className="flex w-[230px] shrink-0 items-center justify-end gap-2 pr-5">
                  {a.totp_enabled ? (
                    <>
                      <button
                        type="button"
                        onClick={() => void copyCode(a)}
                        aria-label={`Copy the two-step code for ${a.label}`}
                        title="Click to copy"
                        className="min-h-[44px] bg-transparent px-2 text-right font-mono"
                      >
                        <span className="block text-[20px] tracking-[0.14em] text-fg">{a.totp_code ? `${a.totp_code.slice(0, 3)} ${a.totp_code.slice(3)}` : '--- ---'}</span>
                        <span className="mt-1 block h-[3px] w-full overflow-hidden rounded-full bg-chip">
                          <span className="block h-full rounded-full transition-[width] duration-1000 ease-linear" style={{ width: `${(left / 30) * 100}%`, background: left <= 5 ? TONE.warn : TONE.good }} />
                        </span>
                        <span className="mt-0.5 block text-[11px]" style={{ color: left <= 5 ? TONE.warn : TONE.muted }}>
                          {copied === a.id ? 'copied' : `live · ${left}s`}
                        </span>
                      </button>
                      <button
                        type="button"
                        aria-label="Refresh the code"
                        title="Refresh"
                        disabled={syncing}
                        onClick={() => void syncNow()}
                        className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-edge bg-raised text-[18px] text-fg disabled:opacity-40"
                      >
                        <span aria-hidden="true" className={syncing ? 'animate-spin' : ''}>
                          ↻
                        </span>
                      </button>
                    </>
                  ) : (
                    <button type="button" className={btn} onClick={() => setEditId(a.id)}>
                      Add code key
                    </button>
                  )}
                </div>
              </div>

              {isOpen ? (
                <div className="flex flex-wrap items-end gap-3 border-t border-divider px-5 pb-4 pl-[46px] pt-3">
                  <div className="basis-40">
                    <label htmlFor={`st-${a.id}`} className={label}>
                      Status
                    </label>
                    <select id={`st-${a.id}`} value={a.status} disabled={busy} onChange={(e) => void patch(a.id, { status: e.target.value as AccountStatus })} className={field}>
                      <option value="warming">Warming</option>
                      <option value="active">Active</option>
                      <option value="paused">Paused</option>
                      <option value="locked">Locked</option>
                    </select>
                  </div>
                  <div className="basis-40">
                    <label htmlFor={`bx-${a.id}`} className={label}>
                      VPS box
                    </label>
                    <select id={`bx-${a.id}`} value={a.box_id ?? ''} disabled={busy} onChange={(e) => void patch(a.id, { box_id: e.target.value || null })} className={field}>
                      <option value="">Unassigned</option>
                      {data.boxes.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="basis-28">
                    <label htmlFor={`cp-${a.id}`} className={label}>
                      Orders / day
                    </label>
                    <input
                      id={`cp-${a.id}`}
                      type="number"
                      min={1}
                      value={capDraft[a.id] ?? String(a.daily_order_cap)}
                      onChange={(e) => setCapDraft({ ...capDraft, [a.id]: e.target.value })}
                      className={field}
                    />
                  </div>
                  <button
                    type="button"
                    disabled={busy || capDraft[a.id] === undefined || Number(capDraft[a.id]) === Number(a.daily_order_cap)}
                    className={btn}
                    onClick={async () => {
                      const ok = await patch(a.id, { daily_order_cap: Number(capDraft[a.id]) });
                      if (ok) {
                        const next = { ...capDraft };
                        delete next[a.id];
                        setCapDraft(next);
                      }
                    }}
                  >
                    Save cap
                  </button>
                  <button type="button" disabled={busy} className={btnAccent} onClick={() => setEditId(a.id)}>
                    Edit details
                  </button>
                  <div className="basis-full font-mono text-xs text-muted">
                    {money(Number(a.spent_today))} spent today · seen {a.last_seen_at && now ? timeAgo(a.last_seen_at, now) : 'never'} · {sessionLabel(a.session_state)}
                    {a.status === 'warming' ? ' · warming' : ''} · {a.card_bank ? cardLabel(a.card_bank, a.card_last4) : 'no card'} · {a.orders_total} orders all time · {a.open_issues} open issues · proxy {a.proxy_label ?? 'none'} · two-step codes{' '}
                    {a.totp_enabled ? 'generating' : 'off'} · password {a.password_set ? 'saved' : 'not set'} · {a.awaiting_tracking}
                    {a.max_pending_orders ? ` / ${a.max_pending_orders}` : ''} awaiting tracking · price limit{' '}
                    {a.daily_spend_cap ? money(Number(a.daily_spend_cap)) : 'none'}
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
        {rows.length === 0 ? (
          <div className="px-5 py-12 text-center font-mono text-[13px] text-muted">
            {data.accounts.length === 0 ? 'no accounts yet. add your first one with Add account.' : 'no accounts in this view.'}
          </div>
        ) : null}
        {pager}
      </Card>
    </>
  );
}
