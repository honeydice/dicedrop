'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { getSnapshot, requestSignin, updateAccount, type AccountPatch, type Result } from '@/app/(console)/actions';
import { cardLabel, money, timeAgo } from '@/lib/format';
import type { OpsAccount, OpsAccounts } from '@/lib/types';
import { Badge, btn, btnAccent, Card, Dot, ErrorNote, field, PageHead, sessionLabel, Tile, TONE } from './ui';
import { usePaged } from './Pager';
import { useLive, useNow } from './useLive';
import { AccountModal } from './AccountModal';

type Filter = 'all' | 'ready' | 'attention' | 'paused' | 'unassigned';

function needsAttention(a: OpsAccount): boolean {
  return a.status === 'locked' || a.session_state === 'needs_sign_in' || a.session_state === 'verification' || a.session_state === 'locked';
}

function isReady(a: OpsAccount): boolean {
  return (a.status === 'active' || a.status === 'warming') && a.session_state === 'signed_in' && a.box_online === true;
}

/** The one-word state shown on each account row. Green only once the account is truly signed in to Amazon. */
function signIn(a: OpsAccount): { text: string; color: string } {
  if (a.signin_requested_at) return { text: a.signin_note ?? 'signing in', color: 'rgb(var(--accent))' };
  if (a.status === 'paused') return { text: 'paused', color: TONE.muted };
  if (a.status === 'locked' || a.session_state === 'locked') return { text: 'locked', color: TONE.bad };
  if (a.session_state === 'verification') return { text: 'needs verification', color: TONE.warn };
  if (a.session_state === 'needs_sign_in') return { text: 'sign-in needed', color: TONE.warn };
  if (!a.box_id) return { text: 'no vps', color: TONE.muted };
  if (a.box_online !== true) return { text: 'vps offline', color: TONE.bad };
  if (a.session_state === 'signed_in') return { text: 'signed in', color: TONE.good };
  return { text: 'not signed in yet', color: TONE.muted };
}

function tone(a: OpsAccount): string {
  if (needsAttention(a)) return a.status === 'locked' || a.session_state === 'locked' ? TONE.bad : TONE.warn;
  if (a.status === 'paused') return TONE.muted;
  if (isReady(a)) return TONE.good;
  return TONE.muted;
}


/** One titled block inside an expanded account. */
function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-panel">
      <div className="border-b border-line px-4 py-2.5 font-mono text-xs text-muted">{title}</div>
      <div className="px-4 py-4">{children}</div>
    </section>
  );
}

function Rows({ items }: { items: [string, string][] }) {
  return (
    <dl className="space-y-2.5 font-mono text-[13px]">
      {items.map(([k, v]) => (
        <div key={k} className="flex items-baseline justify-between gap-4">
          <dt className="shrink-0 text-muted">{k}</dt>
          <dd className="min-w-0 truncate text-right text-fg" title={v}>
            {v}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function AccountsView({ initial, initialError }: { initial: OpsAccounts; initialError: string }) {
  const { data, error, setError, refresh } = useLive<OpsAccounts>('dd_ops_accounts', undefined, initial, initialError);
  const now = useNow();
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState('');
  // Accounts are grouped into one folder per supplier. One folder is open at a time.
  const [folder, setFolder] = useState('amazon');
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState('');
  const [shot, setShot] = useState<{ label: string; taken_at: string; note: string | null; image: string } | null>(null);
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

  const suppliers = Array.from(new Set(['amazon', ...data.accounts.map((a) => a.supplier || 'amazon')])).sort();
  const rows = data.accounts.filter((a) => {
    if ((a.supplier || 'amazon') !== folder) return false;
    if (filter === 'ready') return isReady(a);
    if (filter === 'attention') return needsAttention(a);
    if (filter === 'paused') return a.status === 'paused';
    if (filter === 'unassigned') return !a.box_id;
    return true;
  });

  const { shown, pager } = usePaged(rows, `${folder}:${filter}`);
  const ordersToday = data.accounts.reduce((sum, a) => sum + Number(a.orders_today), 0);
  const capacity = data.accounts.filter((a) => a.status === 'active' || a.status === 'warming').reduce((sum, a) => sum + Number(a.daily_order_cap), 0);

  return (
    <>
      <PageHead title="Accounts">
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

      {shot ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 sm:p-10" onMouseDown={(e) => e.target === e.currentTarget && setShot(null)}>
          <div role="dialog" aria-modal="true" aria-label={`Last screenshot for ${shot.label}`} className="w-full max-w-5xl overflow-hidden rounded-2xl border border-line bg-panel">
            <div className="flex items-center justify-between gap-3 border-b border-line bg-raised px-5 py-3">
              <div className="font-mono text-[13px] text-muted">
                screenshot · {shot.label} · {new Date(shot.taken_at).toLocaleString()}
                {shot.note ? ` · ${shot.note}` : ''}
              </div>
              <button type="button" className="min-h-[44px] bg-transparent px-2 font-mono text-[13px] text-muted hover:text-fg" onClick={() => setShot(null)}>
                close
              </button>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`data:image/jpeg;base64,${shot.image}`} alt={`What the worker saw on ${shot.label}`} className="block w-full" />
          </div>
        </div>
      ) : null}

      <section aria-label="Account health" className="mb-5 flex flex-wrap gap-3">
        <Tile label="Ready" value={`${counts.ready} / ${counts.all}`} tone={counts.ready > 0 ? 'good' : undefined} hint="signed in to Amazon on an online box" />
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

      <Card title={`GET /accounts${folder ? `/${folder}` : ''}${filter === 'all' ? '' : `?filter=${filter}`}`} right={<Badge>{folder ? rows.length : data.accounts.length}</Badge>}>
        {suppliers.map((s) => {
          const inFolder = data.accounts.filter((a) => (a.supplier || 'amazon') === s);
          const online = inFolder.filter(isReady).length;
          const isFolderOpen = folder === s;
          return (
            <div key={s} className="border-b border-divider last:border-b-0">
              <button
                type="button"
                aria-expanded={isFolderOpen}
                onClick={() => setFolder(isFolderOpen ? '' : s)}
                className="flex min-h-[44px] w-full items-center gap-3 bg-transparent px-5 text-left hover:bg-raised/60"
              >
                <span aria-hidden="true" className="w-3 font-mono text-[13px] text-muted">
                  {isFolderOpen ? '▾' : '▸'}
                </span>
                <span className="font-mono text-[13px] font-medium text-fg">{s}/</span>
                <span className="font-mono text-xs text-muted">
                  {inFolder.length} account{inFolder.length === 1 ? '' : 's'} · {online} signed in
                </span>
              </button>
              {isFolderOpen ? (
                <div className="border-t border-divider">
        {shown.map((a) => {
          const isOpen = open === a.id;
          const full = Number(a.orders_today) >= Number(a.daily_order_cap);
          const st = signIn(a);
          return (
            <div key={a.id} className="border-b border-divider last:border-b-0">
              <div className="flex items-center gap-2 pr-4">
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setOpen(isOpen ? '' : a.id)}
                  className="flex min-h-[48px] min-w-0 flex-1 items-center gap-6 bg-transparent py-2 pl-12 pr-2 text-left hover:bg-raised/60"
                >
                  <span className="flex w-[240px] shrink-0 items-center gap-3">
                    <Dot color={st.color} />
                    <span className="font-mono text-[13px] font-medium text-fg">{a.label}</span>
                    <span className="font-mono text-xs" style={{ color: st.color }}>
                      {st.text}
                    </span>
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted">
                    {[a.login_email, a.box_name ?? 'no vps', a.visibility === 'private' ? `private · ${a.allowed_names.join(', ') || 'no clients'}` : 'public'].filter(Boolean).join('  ·  ')}
                    {a.last_error ? <span className="ml-3 text-bad">{a.last_error}</span> : null}
                    {a.current_order ? <span className="ml-3">placing {a.current_order}</span> : null}
                  </span>
                  <span className="w-[110px] shrink-0 whitespace-nowrap text-right font-mono text-xs" style={{ color: full ? TONE.warn : 'rgb(var(--muted))' }}>
                    {a.orders_today} / {a.daily_order_cap} today
                  </span>
                </button>
                <div className="flex w-[172px] shrink-0 items-center justify-end gap-1.5">
                  {a.totp_enabled ? (
                    <>
                      <button
                        type="button"
                        onClick={() => void copyCode(a)}
                        aria-label={`Copy the two-step code for ${a.label}`}
                        title="Click to copy"
                        className="relative h-8 w-[92px] shrink-0 overflow-hidden whitespace-nowrap rounded-md border border-edge bg-raised px-2 text-center font-mono text-[13px] tracking-[0.06em] text-fg hover:border-accent"
                      >
                        {copied === a.id ? 'copied' : a.totp_code ? `${a.totp_code.slice(0, 3)} ${a.totp_code.slice(3)}` : '--- ---'}
                        <span
                          aria-hidden="true"
                          className="absolute bottom-0 left-0 h-[2px] transition-[width] duration-1000 ease-linear"
                          style={{ width: `${(left / 30) * 100}%`, background: left <= 5 ? TONE.warn : TONE.good }}
                        />
                      </button>
                      <span className="w-7 shrink-0 text-right font-mono text-[11px]" style={{ color: left <= 5 ? TONE.warn : 'rgb(var(--muted))' }}>
                        {left}s
                      </span>
                      <button
                        type="button"
                        aria-label="Refresh the code"
                        title="Refresh"
                        disabled={syncing}
                        onClick={() => void syncNow()}
                        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-edge bg-raised text-[13px] text-muted hover:text-fg disabled:opacity-40"
                      >
                        <span aria-hidden="true" className={syncing ? 'animate-spin' : ''}>
                          ↻
                        </span>
                      </button>
                    </>
                  ) : (
                    <button type="button" className="h-8 rounded-md border border-edge bg-raised px-2.5 font-mono text-xs text-muted hover:text-fg" onClick={() => setEditId(a.id)}>
                      add code key
                    </button>
                  )}
                </div>
              </div>

              {isOpen ? (
                <div className="border-t border-divider bg-raised/30 px-6 py-5">
                  <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-4">
                    <Panel title="vps">
                      <div className="flex items-center gap-3">
                        <Dot color={a.box_id ? (a.box_online ? TONE.good : TONE.bad) : TONE.muted} />
                        <span className="font-mono text-[16px] text-fg">{a.box_name ?? 'unassigned'}</span>
                        {a.box_id ? (
                          <span className="font-mono text-[13px]" style={{ color: a.box_online ? TONE.good : TONE.bad }}>
                            {a.box_online ? 'online' : 'offline'}
                          </span>
                        ) : null}
                      </div>
                      <label htmlFor={`bx-${a.id}`} className="mb-1.5 mt-4 block font-mono text-xs text-muted">
                        move to
                      </label>
                      <select id={`bx-${a.id}`} value={a.box_id ?? ''} disabled={busy} onChange={(e) => void patch(a.id, { box_id: e.target.value || null })} className={`${field} font-mono`}>
                        <option value="">unassigned</option>
                        {data.boxes.map((b) => {
                          const n = data.accounts.filter((x) => x.box_id === b.id).length;
                          return (
                            <option key={b.id} value={b.id}>
                              {b.name} · {n} account{n === 1 ? '' : 's'}
                            </option>
                          );
                        })}
                      </select>
                    </Panel>

                    <Panel title="orders / day">
                      <div className="flex items-baseline gap-2 font-mono">
                        <span className="text-[26px] leading-none text-fg">{a.orders_today}</span>
                        <span className="text-[14px] text-muted">of {a.daily_order_cap} today</span>
                      </div>
                      <div className="mt-3 h-2 overflow-hidden rounded-full bg-chip" role="img" aria-label={`${a.orders_today} of ${a.daily_order_cap} orders used today`}>
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${Math.min(100, (Number(a.orders_today) / Math.max(1, Number(a.daily_order_cap))) * 100)}%`, background: full ? TONE.warn : 'rgb(var(--accent))' }}
                        />
                      </div>
                      <div className="mt-4 flex items-center gap-2">
                        <span className="mr-auto font-mono text-xs text-muted">daily limit</span>
                        <button
                          type="button"
                          aria-label="Lower the daily limit by one"
                          disabled={busy || Number(a.daily_order_cap) <= 1}
                          className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-edge bg-raised font-mono text-[18px] text-fg disabled:opacity-40"
                          onClick={() => void patch(a.id, { daily_order_cap: Number(a.daily_order_cap) - 1 })}
                        >
                          −
                        </button>
                        <span className="w-10 text-center font-mono text-[18px] text-fg">{a.daily_order_cap}</span>
                        <button
                          type="button"
                          aria-label="Raise the daily limit by one"
                          disabled={busy}
                          className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-edge bg-raised font-mono text-[18px] text-fg disabled:opacity-40"
                          onClick={() => void patch(a.id, { daily_order_cap: Number(a.daily_order_cap) + 1 })}
                        >
                          +
                        </button>
                      </div>
                    </Panel>

                    <Panel title="identity">
                      <Rows
                        items={[
                          ['email', a.login_email ?? 'none'],
                          ['proxy', a.proxy_label ?? 'none'],
                          ['card', a.card_bank ? cardLabel(a.card_bank, a.card_last4) : 'none'],
                          ['password', a.password_set ? 'saved' : 'not set'],
                          ['two-step', a.totp_enabled ? 'generating' : 'off'],
                          ['access', a.visibility === 'private' ? `private · ${a.allowed_names.join(', ') || 'no clients'}` : 'public'],
                        ]}
                      />
                    </Panel>

                    <Panel title="activity">
                      <Rows
                        items={[
                          ['spent today', `${money(Number(a.spent_today))}${a.daily_spend_cap ? ` of ${money(Number(a.daily_spend_cap))}` : ''}`],
                          ['awaiting tracking', `${a.awaiting_tracking}${a.max_pending_orders ? ` of ${a.max_pending_orders}` : ''}`],
                          ['open issues', String(a.open_issues)],
                          ['orders all time', String(a.orders_total)],
                          ['sign-in', sessionLabel(a.session_state)],
                          ['outgoing ip', a.exit_ip ?? 'not checked yet'],
                          ['device identity', a.has_profile ? 'created' : 'not created yet'],
                          ['last seen', a.last_seen_at && now ? timeAgo(a.last_seen_at, now) : 'never'],
                        ]}
                      />
                    </Panel>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-2.5">
                    <button type="button" disabled={busy} className={btnAccent} onClick={() => setEditId(a.id)}>
                      Edit details
                    </button>
                    <button type="button" disabled={busy} className={btn} onClick={() => void patch(a.id, { status: a.status === 'paused' ? 'active' : 'paused' })}>
                      {a.status === 'paused' ? 'Resume account' : 'Pause account'}
                    </button>
                    <button type="button" disabled={busy || Boolean(a.signin_requested_at) || a.box_online !== true} className={btn} onClick={() => void run(() => requestSignin(a.id))}>
                      {a.signin_requested_at ? 'Signing in' : a.session_state === 'signed_in' ? 'Check sign-in' : 'Sign in now'}
                    </button>
                    {a.snapshot_at ? (
                      <button
                        type="button"
                        disabled={busy}
                        className={btn}
                        onClick={async () => {
                          const result = await getSnapshot(a.id);
                          if (result) setShot({ label: a.label, ...result });
                          else setError('That screenshot could not be loaded. Try again.');
                        }}
                      >
                        View last screenshot
                      </button>
                    ) : null}
                    {a.box_online !== true ? <span className="font-mono text-xs text-muted">sign-in needs this account&apos;s vps online</span> : null}
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
                </div>
              ) : null}
            </div>
          );
        })}
      </Card>
    </>
  );
}
