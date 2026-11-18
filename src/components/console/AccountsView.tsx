'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { updateAccount, type AccountPatch, type Result } from '@/app/(console)/actions';
import { cardLabel, money, timeAgo } from '@/lib/format';
import type { AccountStatus, OpsAccount, OpsAccounts } from '@/lib/types';
import { Badge, btn, btnAccent, Card, Dot, ErrorNote, field, label, PageHead, sessionLabel, sessionTone, Tile, TONE } from './ui';
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
        {rows.map((a) => {
          const isOpen = open === a.id;
          const full = Number(a.orders_today) >= Number(a.daily_order_cap);
          return (
            <div key={a.id} className="border-b border-divider last:border-b-0">
              <div className="flex items-stretch">
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => setOpen(isOpen ? '' : a.id)}
                className="flex min-w-0 flex-1 items-start gap-3.5 bg-transparent px-5 py-3.5 text-left hover:bg-raised/60"
              >
                <span className="mt-[7px]">
                  <Dot color={tone(a)} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-3 font-mono text-[15px]">
                    <span className="text-fg">{a.label}</span>
                    <span className="text-[13px]" style={{ color: a.status === 'paused' ? TONE.muted : sessionTone(a.session_state) }}>
                      {a.status === 'paused' ? 'paused' : a.status === 'locked' ? 'locked' : sessionLabel(a.session_state)}
                    </span>
                    {a.status === 'warming' ? <span className="text-[13px] text-muted">warming</span> : null}
                  </span>
                  <span className="mt-1 block text-[13px] text-muted">
                    {[
                      a.login_email,
                      a.box_name ? `${a.box_name}${a.box_online ? '' : ' (offline)'}` : 'no box assigned',
                      cardLabel(a.card_bank, a.card_last4) !== '—' ? cardLabel(a.card_bank, a.card_last4) : null,
                      a.visibility === 'private' ? `private · ${a.allowed_names.length ? a.allowed_names.join(', ') : 'no clients picked yet'}` : 'public',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  {a.last_error ? <span className="mt-1 block text-[13px] text-bad">{a.last_error}</span> : null}
                  {a.current_order ? <span className="mt-1 block font-mono text-[13px] text-muted">placing {a.current_order}</span> : null}
                </span>
                <span className="shrink-0 text-right font-mono">
                  <span className="block text-[13px]" style={{ color: full ? TONE.warn : undefined }}>
                    {a.orders_today} / {a.daily_order_cap} today
                  </span>
                  <span className="mt-1 block text-[13px] text-muted">{money(Number(a.spent_today))}</span>
                  <span className="block text-xs text-muted">seen {a.last_seen_at && now ? timeAgo(a.last_seen_at, now) : 'never'}</span>
                </span>
              </button>
              {a.totp_enabled ? (
                <button
                  type="button"
                  onClick={() => void copyCode(a)}
                  aria-label={`Copy the two-step code for ${a.label}`}
                  title="Click to copy"
                  className="flex shrink-0 flex-col items-end justify-center border-l border-divider bg-transparent px-5 font-mono hover:bg-raised/60"
                >
                  <span className="text-[18px] tracking-[0.14em] text-fg">
                    {a.totp_code ? `${a.totp_code.slice(0, 3)} ${a.totp_code.slice(3)}` : '--- ---'}
                  </span>
                  <span className="text-[11px]" style={{ color: left <= 5 ? TONE.warn : TONE.muted }}>
                    {copied === a.id ? 'copied' : `${left}s`}
                  </span>
                </button>
              ) : null}
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
                    {a.orders_total} orders all time · {a.open_issues} open issues · proxy {a.proxy_label ?? 'none'} · two-step codes{' '}
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
      </Card>
    </>
  );
}
