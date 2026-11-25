'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { clearHold, createBrowsers, setAllWarmup, removeAccount, setOrdering, setAccountEngine, setAccountStage, setIpGate, setAccountIpGate, setIpTarget, requestIpCheck, setLiveBrowser, getAccountLog, getAccountPassword, getAllAccountLogs, type AllAccessLine, getSnapshot, requestSignin, setWarmup, updateAccount, type AccessLine, type AccountPatch, type Result } from '@/app/(console)/actions';
import { cardLabel, money, timeAgo } from '@/lib/format';
import type { OpsAccount, OpsAccounts } from '@/lib/types';
import { Badge, btn, btnAccent, Card, Dot, ErrorNote, field, PageHead, sessionLabel, Tile, TONE } from './ui';
import { usePaged } from './Pager';
import { useLive, useNow } from './useLive';
import { AccountModal } from './AccountModal';

type Filter = 'all' | 'ready' | 'attention' | 'paused' | 'unassigned';

function needsAttention(a: OpsAccount): boolean {
  return Boolean(a.hold_reason) || Boolean(a.robot_check_at) || (a.browser_note ?? '').startsWith('NEEDS YOU') || a.status === 'locked' || a.session_state === 'needs_sign_in' || a.session_state === 'verification' || a.session_state === 'locked';
}

function isReady(a: OpsAccount): boolean {
  return (a.status === 'active' || a.status === 'warming') && a.session_state === 'signed_in' && a.box_online === true;
}

/** The one-word state shown on each account row. Green only once the account is truly signed in to Amazon. */
function signIn(a: OpsAccount): { text: string; color: string } {
  if (a.robot_check_at) return { text: 'Amazon asks: are you a person · open its browser', color: TONE.bad };
  if (a.in_use_elsewhere) return { text: 'open on another computer · worker waiting', color: TONE.warn };
  if (a.browser_state === 'open' && (a.browser_note ?? '').startsWith('NEEDS YOU')) return { text: 'NEEDS YOU · open the live browser', color: TONE.bad };
  if (a.browser_state) return { text: a.browser_state === 'open' ? 'browser open · in use by hand' : 'opening browser', color: 'rgb(var(--accent))' };
  if (a.hold_reason) return { text: 'on hold · verify account', color: TONE.bad };
  if (a.signin_requested_at) return { text: a.signin_note ?? 'signing in', color: 'rgb(var(--accent))' };
  if (a.status === 'paused') return { text: 'paused', color: TONE.muted };
  if (a.status === 'locked' || a.session_state === 'locked') return { text: 'locked', color: TONE.bad };
  if (a.session_state === 'verification') return { text: 'needs verification', color: TONE.warn };
  if (a.session_state === 'needs_sign_in') return { text: 'sign-in needed', color: TONE.warn };
  if (!a.box_id) return { text: 'no vps', color: TONE.muted };
  if (a.box_online !== true) return { text: 'vps offline', color: TONE.bad };
  if ((a.stage ?? 'live') === 'warmup' && a.session_state === 'signed_in') return { text: 'warm-up · browsing', color: 'rgb(var(--accent))' };
  if (isWarming(a)) return { text: 'warming up', color: 'rgb(var(--accent))' };
  if (a.session_state === 'signed_in') return { text: 'signed in', color: TONE.good };
  return { text: 'not signed in yet', color: TONE.muted };
}

function isWarming(a: OpsAccount): boolean {
  return Boolean(a.warmup_until && new Date(a.warmup_until).getTime() > Date.now());
}

function warmupLeft(a: OpsAccount): string {
  if (!isWarming(a)) return 'off';
  const hours = Math.max(1, Math.round((new Date(a.warmup_until as string).getTime() - Date.now()) / 3600000));
  const left = hours >= 24 ? `${Math.round(hours / 24)}d left` : `${hours}h left`;
  return `${left} · ${a.warmup_sessions ?? 0} session${(a.warmup_sessions ?? 0) === 1 ? '' : 's'}`;
}

/** Warm-up lane summary: how many sessions it has done and when the next one is due. */
function warmSummary(a: OpsAccount): string {
  if ((a.stage ?? 'live') !== 'warmup') return warmupLeft(a);
  const n = a.warmup_sessions ?? 0;
  const next = a.warmup_next_at ? new Date(a.warmup_next_at) : null;
  const when = !next ? 'scheduling' : next.getTime() <= Date.now() ? 'due now' : `next ${next.toLocaleString([], { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`;
  return `${n} session${n === 1 ? '' : 's'} · ${when}${googleWarmth(a)}`;
}

/** Google warmth tag for the row: Google is the strict gate, so a clean search = a warm, real-looking browser. */
function googleWarmth(a: OpsAccount): string {
  if (a.warm_google === 'clean') {
    const s = a.warm_google_streak ?? 0;
    return s >= 3 ? ` · Google ✓ warm (${s})` : ' · Google ✓';
  }
  if (a.warm_google === 'captcha') return ' · Google captcha (cold)';
  return '';
}

/** One-line summary of the account's last IP-gate check. */
function ipSummary(a: OpsAccount): string {
  if (a.ip_check_requested_at) return 'checking…';
  const l = a.ip_last as (OpsAccount['ip_last'] & { error?: string }) | null | undefined;
  if (l && l.error && !l.ip) return `couldn't check: ${l.error}`;
  if (!l || !l.ip) {
    if (a.ip_home_carrier || a.ip_home_region) return `home: ${[a.ip_home_carrier, a.ip_home_region].filter(Boolean).join(', ')}`;
    return 'not checked yet';
  }
  const verdict = l.pass ? '✓ clean' : '✗ flagged';
  const mob = l.is_mobile ? 'mobile' : 'non-mobile';
  const tr = l.tried && l.tried > 1 ? ` · ${l.tried} tries` : '';
  return `${l.ip} · ${l.carrier || '?'} · ${mob} · ${verdict}${tr}`;
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
    <section className="min-w-0 rounded-xl border border-line bg-panel">
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
  // The lanes: live (order-eligible, the default), warm-up (browse-only), and archived (Trash — inert).
  const [view, setView] = useState<'live' | 'warmup' | 'archived'>('live');
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState('');
  // Accounts are grouped into one folder per supplier. One folder is open at a time.
  const [folder, setFolder] = useState('amazon');
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState('');
  const [shot, setShot] = useState<{ label: string; taken_at: string; note: string | null; image: string } | null>(null);
  const [copied, setCopied] = useState('');
  const [logs, setLogs] = useState<{ id: string; lines: AccessLine[] | null } | null>(null);
  const [pw, setPw] = useState<{ id: string; value: string; copied: boolean } | null>(null);
  const [allLogs, setAllLogs] = useState<{ reason: string; lines: AllAccessLine[] | null } | null>(null);
  const loadAllLogs = async (reason: string) => {
    setAllLogs({ reason, lines: null });
    const lines = await getAllAccountLogs(reason);
    setAllLogs({ reason, lines: lines ?? [] });
  };
  // Create browsers (Warm up tab): bulk-mint AA### Multilogin profiles and queue them for warm-up.
  const [createCount, setCreateCount] = useState(10);
  const [createCarrier, setCreateCarrier] = useState('random');
  const [createSupplier, setCreateSupplier] = useState('amazon');
  const [creating, setCreating] = useState(false);
  const [createMsg, setCreateMsg] = useState('');
  const createBatch = async () => {
    setCreating(true);
    setError('');
    setCreateMsg('');
    try {
      const r = await createBrowsers(createCount, { supplier: createSupplier, ...(createCarrier === 'random' ? {} : { carrier: createCarrier }) });
      if (!r.ok) setError(r.error);
      else setCreateMsg(r.note || 'Created.');
      await refresh();
    } catch {
      setError('That did not go through. Try again.');
    } finally {
      setCreating(false);
    }
  };
  const warmAll = async () => {
    setCreating(true);
    setError('');
    setCreateMsg('');
    try {
      const r = await setAllWarmup();
      if (!r.ok) setError(r.error);
      else setCreateMsg(r.note || 'Warming all.');
      await refresh();
    } catch {
      setError('That did not go through. Try again.');
    } finally {
      setCreating(false);
    }
  };
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
  const liveCount = data.accounts.filter((a) => (a.stage ?? 'live') === 'live').length;
  const warmupCount = data.accounts.filter((a) => (a.stage ?? 'live') === 'warmup').length;
  const archivedCount = data.accounts.filter((a) => (a.stage ?? 'live') === 'archived').length;
  const rows = data.accounts.filter((a) => {
    if ((a.stage ?? 'live') !== view) return false;
    if ((a.supplier || 'amazon') !== folder) return false;
    if (filter === 'ready') return isReady(a);
    if (filter === 'attention') return needsAttention(a);
    if (filter === 'paused') return a.status === 'paused';
    if (filter === 'unassigned') return !a.box_id;
    return true;
  });

  const { shown, pager } = usePaged(rows, `${view}:${folder}:${filter}`);
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
          defaultStage={view === 'warmup' ? 'warmup' : 'live'}
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

      <div role="tablist" aria-label="Account lane" className="mb-5 flex gap-2">
        {([['live', 'Active accounts', liveCount], ['warmup', 'Warm up', warmupCount], ['archived', 'Trash', archivedCount]] as [typeof view, string, number][]).map(([v, label, n]) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={view === v}
            onClick={() => { setView(v); setFilter('all'); setOpen(''); }}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border px-4 text-sm font-semibold"
            style={view === v
              ? { background: 'rgb(var(--accent))', borderColor: 'rgb(var(--accent))', color: '#0b0b0b' }
              : { background: 'transparent', borderColor: 'rgb(var(--line))', color: 'rgb(var(--muted))' }}
          >
            {label}
            <span className="rounded-full px-[7px] py-0.5 font-mono text-xs" style={view === v ? { background: 'rgba(0,0,0,.18)' } : { background: 'var(--chip)' }}>{n}</span>
          </button>
        ))}
      </div>

      {view === 'warmup' ? (
        <>
          <p className="mb-4 text-[13px] text-muted">
            Warm-up accounts only ever browse Amazon — searching, reading, wandering sections, adding to cart and emptying it — on a rotating schedule. They are never handed an order until you move one to live.
          </p>
          <div className="mb-5 rounded-xl border border-line bg-panel p-4">
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1">
                <span className="font-mono text-xs text-muted">store</span>
                <select value={createSupplier} onChange={(e) => setCreateSupplier(e.target.value)} className={`${field} w-36`}>
                  <option value="amazon">Amazon</option>
                  <option value="walmart">Walmart</option>
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="font-mono text-xs text-muted">how many</span>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={createCount}
                  onChange={(e) => setCreateCount(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
                  className={`${field} w-24`}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="font-mono text-xs text-muted">carrier</span>
                <select value={createCarrier} onChange={(e) => setCreateCarrier(e.target.value)} className={`${field} w-44`}>
                  <option value="random">Random (recommended)</option>
                  <option value="verizon_g_home">Verizon</option>
                  <option value="t_mobile_usa">T-Mobile</option>
                </select>
              </label>
              <button type="button" className={btnAccent} disabled={creating} onClick={() => void createBatch()}>
                {creating ? 'creating…' : `Create ${createCount} browser${createCount === 1 ? '' : 's'}`}
              </button>
              <button type="button" className={btn} disabled={creating} onClick={() => void warmAll()}>
                Warm up all
              </button>
            </div>
            <p className="mt-3 text-[12px] text-muted">
              Each one is a macOS browser on a mobile IP in Los Angeles, California, named {createSupplier === 'walmart' ? 'WW' : 'AA'}### after the highest so far, and warms on {createSupplier === 'walmart' ? 'Walmart' : 'Amazon'}. They’re spread across your online boxes, built one by one, then start warming on their own.
            </p>
            {createMsg ? <p className="mt-2 text-[13px]" style={{ color: 'rgb(var(--accent))' }}>{createMsg}</p> : null}
          </div>
        </>
      ) : null}
      {view === 'archived' ? (
        <p className="mb-4 text-[13px] text-muted">
          Trashed accounts do nothing — no orders, no warm-up, no checks. They stay here in case you need their details or history. Restore one to a lane, or remove it for good.
        </p>
      ) : null}

      <section aria-label="Account health" className="mb-5 flex flex-wrap gap-3">
        <Tile label="Ready" value={`${counts.ready} / ${counts.all}`} tone={counts.ready > 0 ? 'good' : undefined} hint="signed in to Amazon on an online box" />
        <Tile label="Need attention" value={String(counts.attention)} tone={counts.attention > 0 ? 'warn' : undefined} hint="sign-in, verification, or locked" />
        <Tile label="Orders today" value={`${ordersToday} / ${capacity}`} hint="placed against total daily capacity" />
      </section>

      <div role="tablist" aria-label="Account filter" className="-mx-3 mb-4 flex gap-1 overflow-x-auto border-b border-line px-3 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 [&::-webkit-scrollbar]:hidden">
        {(['all', 'ready', 'attention', 'paused', 'unassigned'] as Filter[]).map((f) => (
          <button
            key={f}
            type="button"
            role="tab"
            aria-selected={filter === f}
            onClick={() => setFilter(f)}
            className="-mb-px inline-flex min-h-[44px] shrink-0 items-center gap-2 border-b-2 bg-transparent px-3 text-sm font-medium capitalize sm:px-3.5"
            style={{ borderBottomColor: filter === f ? 'rgb(var(--accent))' : 'transparent', color: filter === f ? 'rgb(var(--strong))' : 'rgb(var(--muted))' }}
          >
            {f === 'attention' ? 'Needs attention' : f}
            <span className="rounded-full bg-chip px-[7px] py-0.5 font-mono text-xs text-soft">{counts[f]}</span>
          </button>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button type="button" className={btn} aria-expanded={allLogs !== null} onClick={() => (allLogs ? setAllLogs(null) : void loadAllLogs(''))}>
          {allLogs ? 'Hide activity log' : 'Activity log'}
        </button>
        {allLogs
          ? [
              ['', 'All'],
              ['warm-up', 'Warm-ups'],
              ['sign-in', 'Sign-ins'],
              ['order check', 'Order checks'],
              ['place order', 'Orders'],
            ].map(([value, label]) => (
              <button
                key={label}
                type="button"
                className={btn}
                style={allLogs.reason === value ? { borderColor: 'rgb(var(--accent))', color: 'rgb(var(--accent))' } : undefined}
                onClick={() => void loadAllLogs(value)}
              >
                {label}
              </button>
            ))
          : null}
      </div>
      {allLogs ? (
        <div className="mb-4 max-h-[420px] overflow-auto rounded-md border border-divider font-mono text-xs">
          {allLogs.lines === null ? (
            <div className="px-3 py-2.5 text-muted">loading</div>
          ) : allLogs.lines.length === 0 ? (
            <div className="px-3 py-2.5 text-muted">nothing logged yet</div>
          ) : (
            allLogs.lines.map((l, i) => (
              <div key={l.at + i} className="flex flex-wrap items-start gap-x-3 gap-y-0.5 border-b border-divider px-3 py-1.5 last:border-b-0">
                <span className="mt-[5px] h-2 w-2 shrink-0 rounded-full" style={{ background: l.ok ? '#4ade80' : '#dc2626' }} />
                <span className="w-[150px] shrink-0 text-muted">
                  {new Date(l.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' })}
                </span>
                <span className="w-[70px] shrink-0 font-semibold text-fg">{l.account}</span>
                <span className="w-[170px] shrink-0 truncate text-fg" title={l.reason}>
                  {l.reason}
                </span>
                <span className="min-w-0 flex-1 break-words text-soft">
                  {l.result}
                  {l.seconds != null ? ` · ${l.seconds}s` : ''}
                  {l.exit_ip ? ` · ${l.exit_ip}` : ''}
                </span>
              </div>
            ))
          )}
        </div>
      ) : null}

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
              <div className="flex flex-wrap items-center gap-x-2 sm:flex-nowrap sm:pr-4">
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setOpen(isOpen ? '' : a.id)}
                  className="flex min-h-[48px] min-w-0 flex-1 basis-full items-center gap-3 bg-transparent py-2 pl-4 pr-3 text-left hover:bg-raised/60 sm:basis-auto sm:gap-6 sm:pl-12 sm:pr-2"
                >
                  <span className="flex min-w-0 flex-1 items-center gap-3 sm:w-[240px] sm:flex-none sm:shrink-0">
                    <Dot color={st.color} />
                    <span className="font-mono text-[13px] font-medium text-fg">{a.label}</span>
                    <span className="font-mono text-xs" style={{ color: st.color }}>
                      {st.text}
                    </span>
                  </span>
                  <span className="hidden min-w-0 flex-1 truncate font-mono text-xs text-muted sm:block">
                    {[a.login_email, a.box_name ?? 'no vps', a.engine === 'multilogin' ? 'Multilogin' : 'Kameleo'].filter(Boolean).join('  ·  ')}
                    {a.ordering_enabled === false ? <span className="ml-3" style={{ color: TONE.warn }}>ordering off</span> : null}
                    {a.last_error ? <span className="ml-3 text-bad">{a.last_error}</span> : null}
                    {a.current_order ? <span className="ml-3">placing {a.current_order}</span> : null}
                  </span>
                  <span className="shrink-0 whitespace-nowrap text-right font-mono text-xs sm:w-[110px]" style={{ color: full ? TONE.warn : 'rgb(var(--muted))' }}>
                    {a.orders_today} / {a.daily_order_cap} today
                  </span>
                </button>
                <div className="flex w-full shrink-0 items-center justify-start gap-1.5 pb-2.5 pl-[38px] sm:w-[172px] sm:justify-end sm:pb-0 sm:pl-0">
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
                <div className="border-t border-divider bg-raised/30 px-3 py-4 sm:px-6 sm:py-5">
                  {/* One row of controls: the ordering switch, one Actions menu, and the live browser link when it is open. */}
                  <div className="mb-4 flex flex-wrap items-center gap-2.5">
                    {(a.stage ?? 'live') === 'archived' ? (
                      <>
                        <button
                          type="button"
                          disabled={busy}
                          className={btnAccent}
                          onClick={() => { if (window.confirm(`Restore ${a.label} to live? It becomes eligible for orders again.`)) void run(() => setAccountStage(a.id, 'live')); }}
                        >
                          Restore to live
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          className={btn}
                          onClick={() => void run(() => setAccountStage(a.id, 'warmup'))}
                        >
                          Restore to warm up
                        </button>
                      </>
                    ) : (a.stage ?? 'live') === 'warmup' ? (
                      <button
                        type="button"
                        disabled={busy}
                        className={btnAccent}
                        onClick={() => { if (window.confirm(`Move ${a.label} to live? It becomes eligible for orders and moves to the Active accounts tab.`)) void run(() => setAccountStage(a.id, 'live')); }}
                      >
                        Move to live →
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={busy}
                        aria-pressed={a.ordering_enabled !== false}
                        className={btn}
                        style={a.ordering_enabled === false ? { borderColor: TONE.warn, color: TONE.warn } : { borderColor: TONE.good, color: TONE.good }}
                        onClick={() => void run(() => setOrdering(a.id, a.ordering_enabled === false))}
                      >
                        {a.ordering_enabled === false ? 'Ordering: OFF · checks only' : 'Ordering: ON'}
                      </button>
                    )}
                    <select
                      aria-label={`Actions for ${a.label}`}
                      disabled={busy}
                      className={`${btnAccent} max-w-[230px]`}
                      value=""
                      onChange={async (e) => {
                        const choice = e.target.value;
                        e.target.value = '';
                        if (choice === 'edit') setEditId(a.id);
                        else if (choice === 'signin') void run(() => requestSignin(a.id));
                        else if (choice === 'browser') void run(() => setLiveBrowser(a.id, !a.browser_state));
                        else if (choice === 'pause') void patch(a.id, { status: a.status === 'paused' ? 'active' : 'paused' });
                        else if (choice === 'hold') void run(() => clearHold(a.id));
                        else if (choice === 'tolive') void run(() => setAccountStage(a.id, 'live'));
                        else if (choice === 'towarmup') void run(() => setAccountStage(a.id, 'warmup'));
                        else if (choice === 'toarchived') { if (window.confirm(`Move ${a.label} to Trash? It stops all activity but is kept so you can restore it.`)) void run(() => setAccountStage(a.id, 'archived')); }
                        else if (choice.startsWith('warm:')) void run(() => setWarmup(a.id, Number(choice.slice(5))));
                        else if (choice === 'kameleo') void run(() => setAccountEngine(a.id, 'kameleo', ''));
                        else if (choice === 'multilogin') {
                          const name = window.prompt('Name of this account\'s profile in Multilogin (exactly as it shows there):', a.mlx_profile ?? a.label);
                          if (name && name.trim()) void run(() => setAccountEngine(a.id, 'multilogin', name.trim()));
                        } else if (choice === 'logs') {
                          if (logs?.id === a.id) return setLogs(null);
                          setLogs({ id: a.id, lines: null });
                          const lines = await getAccountLog(a.id);
                          if (lines) setLogs({ id: a.id, lines });
                          else {
                            setLogs(null);
                            setError('The log could not be loaded. Try again.');
                          }
                        } else if (choice === 'shot') {
                          const result = await getSnapshot(a.id);
                          if (result) setShot({ label: a.label, ...result });
                          else setError('That screenshot could not be loaded. Try again.');
                        } else if (choice === 'pw') {
                          if (pw?.id === a.id) return setPw(null);
                          const value = await getAccountPassword(a.id);
                          if (value) setPw({ id: a.id, value, copied: false });
                          else setError('The password could not be loaded. Try again.');
                        } else if (choice === 'remove') {
                          if (window.confirm(`Remove ${a.label} from DiceDrop? Its saved password, logs and screenshots are deleted. Its orders stay in the Orders list.`)) {
                            void run(() => removeAccount(a.id));
                          }
                        }
                      }}
                    >
                      <option value="">Actions</option>
                      <option value="edit">Edit details</option>
                      <option value="signin" disabled={Boolean(a.signin_requested_at) || a.box_online !== true}>
                        {a.signin_requested_at ? 'Signing in…' : a.session_state === 'signed_in' ? 'Check sign-in' : 'Sign in now'}
                      </option>
                      <option value="browser" disabled={!a.browser_state && a.box_online !== true}>
                        {a.browser_state === 'open' ? 'Close browser' : a.browser_state ? 'Cancel opening the browser' : 'Open browser (use by hand)'}
                      </option>
                      <option value="logs">{logs?.id === a.id ? 'Hide logs' : 'Logs'}</option>
                      {a.snapshot_at ? <option value="shot">Last screenshot</option> : null}
                      {a.password_set ? <option value="pw">{pw?.id === a.id ? 'Hide password' : 'Show password'}</option> : null}
                      <optgroup label={isWarming(a) ? 'Warm-up (on)' : 'Warm-up'}>
                        {[1, 2, 3, 5, 7].map((d) => (
                          <option key={d} value={`warm:${d}`}>
                            Warm up {d} day{d === 1 ? '' : 's'}
                          </option>
                        ))}
                        {isWarming(a) ? <option value="warm:0">Turn warm-up off</option> : null}
                      </optgroup>
                      <optgroup label={a.engine === 'multilogin' ? 'Browser: Multilogin' : 'Browser: Kameleo'}>
                        <option value="multilogin">{a.engine === 'multilogin' ? 'Change Multilogin profile' : 'Switch to Multilogin'}</option>
                      </optgroup>
                      <optgroup label="Account">
                        {(a.stage ?? 'live') === 'archived' ? (
                          <>
                            <option value="tolive">Restore to live</option>
                            <option value="towarmup">Restore to warm up</option>
                          </>
                        ) : (a.stage ?? 'live') === 'warmup' ? (
                          <>
                            <option value="tolive">Move to live (allow orders)</option>
                            <option value="toarchived">Move to Trash</option>
                          </>
                        ) : (
                          <>
                            <option value="towarmup">Move to warm up (browse only)</option>
                            <option value="toarchived">Move to Trash</option>
                          </>
                        )}
                        {a.hold_reason ? <option value="hold">Account verified · clear hold</option> : null}
                        <option value="pause">{a.status === 'paused' ? 'Resume account' : 'Pause account (nothing opens it)'}</option>
                        <option value="remove">Remove account</option>
                      </optgroup>
                    </select>
                    {a.browser_state === 'open' && a.browser_url ? (
                      <a href={a.browser_url} target="_blank" rel="noreferrer" className={btnAccent}>
                        Go to live browser
                      </a>
                    ) : a.browser_state ? (
                      <span className="font-mono text-xs text-muted">opening browser · {a.browser_note ?? ''}</span>
                    ) : null}
                    {a.browser_state === 'open' && (a.browser_note ?? '').startsWith('NEEDS YOU') ? (
                      <span className="text-[13px]" style={{ color: TONE.bad }}>
                        {a.browser_note}
                      </span>
                    ) : null}
                    {a.box_online !== true ? <span className="font-mono text-xs text-muted">vps offline</span> : null}
                  </div>

                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <Panel title="setup">
                      <Rows
                        items={[
                          ['amazon email', a.login_email ?? 'none'],
                          ['browser', a.engine === 'multilogin' ? `Multilogin · ${a.mlx_profile ?? ''}${a.mlx_found ? '' : ' (not opened yet)'}` : `Kameleo${a.has_profile ? '' : ' (not opened yet)'}`],
                          ['address', a.exit_ip_info ? a.exit_ip_info.replace(/^AS\d+\s+/, '').split(' · ').slice(0, 2).join(' · ') : a.exit_ip ?? (a.engine === 'multilogin' ? 'from the Multilogin profile' : a.proxy_label ?? 'no proxy')],
                          ['card', a.card_bank ? cardLabel(a.card_bank, a.card_last4) : 'none'],
                          ['password · two-step', `${a.password_set ? 'saved' : 'not set'} · ${a.totp_enabled ? 'on' : 'off'}`],
                          ['ip check', ipSummary(a)],
                        ]}
                      />
                      <div className="mt-3 flex items-center gap-3">
                        <Dot color={a.box_id ? (a.box_online ? TONE.good : TONE.bad) : TONE.muted} />
                        <label htmlFor={`bx-${a.id}`} className="font-mono text-xs text-muted">
                          vps
                        </label>
                        <select id={`bx-${a.id}`} value={a.box_id ?? ''} disabled={busy} onChange={(e) => void patch(a.id, { box_id: e.target.value || null })} className={`${field} min-w-0 font-mono`}>
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
                      </div>
                      <div className="mt-3 flex items-center gap-3">
                        <span className="font-mono text-xs text-muted">ip gate</span>
                        <button type="button" disabled={busy} className={btn}
                          style={a.ip_gate_on ? { borderColor: TONE.good, color: TONE.good } : { borderColor: 'rgb(var(--line))', color: 'rgb(var(--muted))' }}
                          onClick={() => void run(() => setAccountIpGate(a.id, !a.ip_gate_on))}>
                          {a.ip_gate_on ? 'on · checked before open' : 'off'}
                        </button>
                      </div>
                      <div className="mt-3 flex items-center gap-3">
                        <label htmlFor={`ipt-${a.id}`} className="font-mono text-xs text-muted">ip target</label>
                        <input id={`ipt-${a.id}`} type="text" defaultValue={a.ip_target_location ?? ''} placeholder="e.g. California or Rocklin, CA" disabled={busy}
                          className={`${field} min-w-0`}
                          onBlur={(e) => { const v = e.target.value.trim(); if (v !== (a.ip_target_location ?? '')) void run(() => setIpTarget(a.id, v)); }} />
                        <button type="button" disabled={busy || !!a.ip_check_requested_at} className={btn}
                          onClick={() => void run(() => requestIpCheck(a.id))}>
                          {a.ip_check_requested_at ? 'checking…' : 'Check IP'}
                        </button>
                      </div>
                    </Panel>

                    <Panel title="activity">
                      <Rows
                        items={[
                          ['sign-in', `${sessionLabel(a.session_state)}${a.last_seen_at && now ? ` · seen ${timeAgo(a.last_seen_at, now)}` : ''}`],
                          ['ordering', a.ordering_enabled === false ? 'off · order checks only' : isWarming(a) ? 'waiting for warm-up to end' : a.status === 'paused' ? 'paused' : 'on'],
                          ['warm-up', warmSummary(a)],
                          ['waiting to ship', `${a.awaiting_tracking}${a.max_pending_orders ? ` of ${a.max_pending_orders}` : ''}`],
                          ['open issues · all orders', `${a.open_issues} · ${a.orders_total}`],
                          ['spent today', `${money(Number(a.spent_today))}${a.daily_spend_cap ? ` of ${money(Number(a.daily_spend_cap))}` : ''}`],
                        ]}
                      />
                      <div className="mt-3 flex items-center gap-2">
                        <span className="mr-auto font-mono text-xs text-muted">
                          orders today {a.orders_today} of {a.daily_order_cap}
                        </span>
                        <button
                          type="button"
                          aria-label="Lower the daily limit by one"
                          disabled={busy || Number(a.daily_order_cap) <= 1}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-edge bg-raised font-mono text-[16px] text-fg disabled:opacity-40"
                          onClick={() => void patch(a.id, { daily_order_cap: Number(a.daily_order_cap) - 1 })}
                        >
                          −
                        </button>
                        <span className="w-8 text-center font-mono text-[15px] text-fg">{a.daily_order_cap}</span>
                        <button
                          type="button"
                          aria-label="Raise the daily limit by one"
                          disabled={busy}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-edge bg-raised font-mono text-[16px] text-fg disabled:opacity-40"
                          onClick={() => void patch(a.id, { daily_order_cap: Number(a.daily_order_cap) + 1 })}
                        >
                          +
                        </button>
                      </div>
                    </Panel>
                  </div>

                  {a.hold_reason ? (
                    <div className="mt-3 rounded-md border px-3 py-2 text-[13px]" style={{ borderColor: TONE.bad, color: TONE.bad }}>
                      Amazon: {a.hold_reason}
                    </div>
                  ) : null}
                  {pw?.id === a.id ? (
                    <div className="mt-3 flex flex-wrap items-center gap-3 rounded-md border border-divider bg-raised px-3 py-2">
                      <span className="font-mono text-xs text-muted">{a.login_email}</span>
                      <code className="min-w-0 flex-1 select-all break-all font-mono text-[14px] text-fg">{pw.value}</code>
                      <button
                        type="button"
                        className={btnAccent}
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(pw.value);
                            setPw({ ...pw, copied: true });
                          } catch {
                            setError('Copy did not work. Press and hold the password to copy it.');
                          }
                        }}
                      >
                        {pw.copied ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                  ) : null}
                  {logs?.id === a.id ? (
                    <div className="mt-3 overflow-hidden rounded-md border border-divider font-mono text-xs">
                      {logs.lines === null ? (
                        <div className="px-3 py-2.5 text-muted">loading</div>
                      ) : logs.lines.length === 0 ? (
                        <div className="px-3 py-2.5 text-muted">no sessions logged yet</div>
                      ) : (
                        logs.lines.map((l, i) => (
                          <div key={l.at + i} className="flex items-start gap-3 border-b border-divider px-3 py-1.5 last:border-b-0">
                            <span className="mt-[5px] h-2 w-2 shrink-0 rounded-full" style={{ background: l.ok ? '#4ade80' : '#dc2626' }} />
                            <span className="w-[150px] shrink-0 text-muted" title={now ? timeAgo(l.at, now) : undefined}>
                              {new Date(l.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' })}
                            </span>
                            <span className="w-[230px] shrink-0 truncate text-fg" title={l.reason}>
                              {l.reason}
                            </span>
                            <span className="min-w-0 flex-1 break-words" style={{ color: l.ok ? undefined : '#ef4444' }}>
                              {l.result ?? (l.ok ? 'done' : 'failed')}
                            </span>
                            <span className="hidden w-[52px] shrink-0 text-right text-muted md:block">{l.seconds != null ? `${l.seconds}s` : ''}</span>
                          </div>
                        ))
                      )}
                    </div>
                  ) : null}
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
      {data.ip_gate ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[11px] text-muted">
          <span>IP gate is per-account (toggle it on an account). Global:</span>
          <label className="inline-flex items-center gap-1.5">
            <input type="checkbox" checked={data.ip_gate.before_orders} disabled={busy}
              onChange={(e) => { const g = data.ip_gate!; void run(() => setIpGate(g.enabled, e.target.checked, g.budget)); }} />
            also check before orders
          </label>
          <span>checks today: <span className="font-mono" style={{ color: data.ip_gate.used >= data.ip_gate.budget ? TONE.bad : undefined }}>{data.ip_gate.used.toLocaleString()} / {data.ip_gate.budget.toLocaleString()}</span></span>
          <label className="inline-flex items-center gap-1.5">budget/day
            <input type="number" min={1} defaultValue={data.ip_gate.budget} disabled={busy} className={`${field} w-20`}
              onBlur={(e) => { const g = data.ip_gate!; const v = parseInt(e.target.value || '0', 10); if (v > 0 && v !== g.budget) void run(() => setIpGate(g.enabled, g.before_orders, v)); }} />
          </label>
        </div>
      ) : null}
    </>
  );
}
