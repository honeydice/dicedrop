'use client';

import { useState } from 'react';
import { deleteBox, rotateBoxToken, serverPower, setBoxState, syncContabo, type Result } from '@/app/(console)/actions';
import { timeAgo } from '@/lib/format';
import type { BoxState, OpsBox, OpsBoxes } from '@/lib/types';
import { Badge, btn, btnAccent, btnDanger, Card, Dot, ErrorNote, PageHead, sessionLabel, sessionTone, Tile, TONE } from './ui';
import { usePaged } from './Pager';
import { useLive, useNow } from './useLive';

function connTone(b: OpsBox): string {
  if (b.connection === 'online') return b.desired_state === 'run' ? TONE.good : TONE.warn;
  if (b.connection === 'offline') return TONE.bad;
  return TONE.muted;
}

function connText(b: OpsBox): string {
  if (b.connection === 'never') return 'box.waiting_for_first_connection';
  if (b.connection === 'offline') return 'box.not_connecting';
  if (b.desired_state === 'pause') return 'box.paused';
  if (b.desired_state === 'drain') return 'box.draining';
  return 'box.online';
}

function serverTone(status: string | null): string {
  if (status === 'running') return TONE.good;
  if (status === 'stopped' || status === 'error' || status === 'gone') return TONE.bad;
  if (!status) return TONE.muted;
  return TONE.warn;
}

function specs(b: OpsBox): string {
  const parts = [
    b.server_cpu ? `${b.server_cpu} cores` : null,
    b.server_ram_mb ? `${Math.round(b.server_ram_mb / 1024)} GB RAM` : null,
    b.server_disk_mb ? `${Math.round(b.server_disk_mb / 1024)} GB disk` : null,
  ].filter(Boolean);
  return parts.join(' / ');
}

// Boxes always install from the public address, whichever address the console is open on.
const SITE_URL = 'https://dicedrop.vercel.app';

export function VpsView({ initial, initialError, perBox = 5 }: { initial: OpsBoxes; initialError: string; perBox?: number }) {
  const { data, error, setError, refresh } = useLive<OpsBoxes>('dd_ops_boxes', undefined, initial, initialError, 5000);
  const { shown: shownBoxes, pager } = usePaged(data.boxes);
  const now = useNow();
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState<{ box: string; value: string } | null>(null);
  const [copiedCmd, setCopiedCmd] = useState(false);
  const installCommand = (value: string) =>
    `curl -fsSL ${SITE_URL}/dd/install.sh | sudo bash -s -- ${value}`;
  const [open, setOpen] = useState('');

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

  const online = data.boxes.filter((b) => b.connection === 'online').length;
  const working = data.boxes.reduce((sum, b) => sum + b.working.length, 0);
  const placedToday = data.boxes.reduce((sum, b) => sum + Number(b.placed_today), 0);

  const stateButton = (b: OpsBox, state: BoxState, text: string) => (
    <button type="button" disabled={busy || b.desired_state === state} className={btn} onClick={() => void run(() => setBoxState(b.id, state))}>
      {text}
    </button>
  );

  return (
    <>
      <PageHead title="VPS">
        {data.contabo?.connected ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-mono text-xs text-muted">
              contabo synced {data.contabo.last_sync_at && now ? timeAgo(data.contabo.last_sync_at, now) : 'never'}
            </span>
            <button type="button" disabled={busy} className={btn} onClick={() => void run(() => syncContabo())}>
              Sync servers
            </button>
          </div>
        ) : null}
      </PageHead>
      {data.contabo?.connected && data.contabo.last_sync_error ? <ErrorNote message={`Contabo sync: ${data.contabo.last_sync_error}`} /> : null}
      <ErrorNote message={error} />

      <section aria-label="Fleet" className="mb-5 flex flex-wrap gap-3">
        <Tile label="Boxes online" value={`${online} / ${data.boxes.length}`} tone={data.boxes.length > 0 && online === data.boxes.length ? 'good' : online < data.boxes.length ? 'warn' : undefined} />
        <Tile label="Ordering now" value={String(working)} hint="orders in checkout" />
        <Tile label="Waiting in line" value={String(data.pending_total)} tone="accent" hint="pending orders" />
        <Tile label="Placed today" value={String(placedToday)} />
      </section>


      {data.boxes.length === 0 ? (
        <Card>
          <div className="px-5 py-12 text-center font-mono text-[13px] text-muted">
            no boxes yet. connect contabo under settings to import your servers.
          </div>
        </Card>
      ) : null}

      {data.boxes.length > 0 ? (
      <Card title="GET /vps" right={<Badge>{data.boxes.length}</Badge>}>
        {shownBoxes.map((b) => {
          const isOpen = open === b.id;
          const attention = b.accounts.filter((x) => x.status === 'locked' || x.session_state === 'needs_sign_in' || x.session_state === 'verification' || x.session_state === 'locked').length;
          const problem = Boolean(b.last_error || b.server_error) || attention > 0 || b.working.some((w) => w.stuck);
          return (
          <div key={b.id} className="border-b border-divider last:border-b-0">
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => setOpen(isOpen ? '' : b.id)}
              className="flex w-full flex-wrap items-center gap-x-3.5 gap-y-1 bg-transparent px-5 py-2.5 text-left hover:bg-raised/60"
            >
              <Dot color={connTone(b)} />
              <span className="font-mono text-[14px] text-fg">{b.name}</span>
              <span className="font-mono text-[13px] text-muted">{connText(b)}</span>
              {b.provider_instance_id ? (
                <span className="font-mono text-[13px]" style={{ color: serverTone(b.server_status) }}>
                  server.{b.server_status ?? 'unknown'}
                </span>
              ) : null}
              {problem ? <span className="font-mono text-[13px] text-bad">needs attention</span> : null}
              <span className="ml-auto font-mono text-xs text-muted">
                {[
                  b.working.length > 0 ? `placing ${b.working.length}` : 'idle',
                  `${b.accounts.length} / ${perBox} accts`,
                  `${b.placed_today} today`,
                  b.last_heartbeat && now ? `hb ${timeAgo(b.last_heartbeat, now)}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </button>

            {isOpen ? (
            <div className="border-t border-divider bg-raised/40">
            <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
              <div className="flex items-start gap-3.5">
                <span className="mt-[7px]">
                  <Dot color={connTone(b)} />
                </span>
                <div>
                  <div className="font-mono text-[15px]">{connText(b)}</div>
                  <div className="mt-0.5 font-mono text-xs text-muted">
                    {[
                      b.last_heartbeat && now ? `heartbeat ${timeAgo(b.last_heartbeat, now)}` : 'no heartbeat yet',
                      b.worker_version ? `worker v${b.worker_version}` : null,
                      b.hostname,
                      b.reported_state ? `reports ${b.reported_state}` : null,
                      b.token_prefix ? `${b.token_prefix}…` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                  {b.last_error ? (
                    <div className="mt-1 text-[13px] text-bad">
                      {b.last_error}
                      {b.last_error_at && now ? <span className="text-muted"> · {timeAgo(b.last_error_at, now)}</span> : null}
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {stateButton(b, 'run', 'Run')}
                {stateButton(b, 'pause', 'Pause')}
                {stateButton(b, 'drain', 'Drain')}
                <button
                  type="button"
                  disabled={busy}
                  className={btn}
                  onClick={async () => {
                    if (b.has_token && !window.confirm(`Make a new install command for ${b.name}? If this box is already installed, it will need to be installed again.`)) return;
                    const result = await run(() => rotateBoxToken(b.id));
                    if (result?.ok && result.secret) setToken({ box: b.name, value: result.secret });
                  }}
                >
                  Install command
                </button>
                <button
                  type="button"
                  disabled={busy}
                  className={btnDanger}
                  onClick={() => {
                    const note = b.provider_instance_id
                      ? 'The Contabo server itself keeps running; it is just left out of DiceDrop. You can bring it back from Settings.'
                      : 'This cannot be undone.';
                    if (!window.confirm(`Remove ${b.name}? Its accounts become unassigned. ${note}`)) return;
                    void run(() => deleteBox(b.id));
                  }}
                >
                  Remove
                </button>
              </div>
              {token && token.box === b.name ? (
        <div role="status" className="mt-4 overflow-hidden rounded-2xl border border-accent/50 bg-panel">
          <div className="flex items-center justify-between gap-3 border-b border-line bg-raised px-5 py-3">
            <div className="font-mono text-[13px] text-muted">install {token.box}</div>
            <button type="button" className="min-h-[44px] bg-transparent px-2 font-mono text-[13px] text-muted hover:text-fg" onClick={() => setToken(null)}>
              close
            </button>
          </div>
          <div className="px-5 py-4">
            <code className="block break-all rounded-[10px] border border-edge bg-raised px-3.5 py-3 font-mono text-[13px] text-fg">{installCommand(token.value)}</code>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                className={btnAccent}
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(installCommand(token.value));
                    setCopiedCmd(true);
                    setTimeout(() => setCopiedCmd(false), 1500);
                  } catch {
                    // Clipboard is unavailable; the command is on screen to select by hand.
                  }
                }}
              >
                {copiedCmd ? 'Copied' : 'Copy command'}
              </button>
              <span className="font-mono text-xs text-muted">shown once · paste into the box as root</span>
            </div>
          </div>
        </div>
      ) : null}
            </div>

            {b.provider_instance_id ? (
              <div className="flex flex-wrap items-center justify-between gap-4 border-t border-divider px-5 py-3">
                <div className="flex items-start gap-3.5">
                  <span className="mt-[7px]">
                    <Dot color={serverTone(b.server_status)} />
                  </span>
                  <div>
                    <div className="font-mono text-[15px]">server.{b.server_status ?? 'unknown'}</div>
                    <div className="mt-0.5 font-mono text-xs text-muted">
                      {[b.provider, b.server_ip, b.server_region, specs(b), b.server_product].filter(Boolean).join(' · ')}
                    </div>
                    {b.server_error ? <div className="mt-1 text-[13px] text-bad">{b.server_error}</div> : null}
                    {b.last_action ? (
                      <div className="mt-0.5 font-mono text-xs text-muted">
                        last: {b.last_action.type} by {b.last_action.actor.replace('user:', '')}
                        {now ? ` · ${timeAgo(b.last_action.created_at, now)}` : ''}
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={busy || b.server_status === 'running'} className={btn} onClick={() => void run(() => serverPower(b.id, 'start'))}>
                    Start
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    className={btn}
                    onClick={() => {
                      if (!window.confirm(`Restart the server ${b.name}? Any order it is placing right now will be interrupted.`)) return;
                      void run(() => serverPower(b.id, 'restart'));
                    }}
                  >
                    Restart
                  </button>
                  <button
                    type="button"
                    disabled={busy || b.server_status === 'stopped'}
                    className={btnDanger}
                    onClick={() => {
                      if (!window.confirm(`Shut down the server ${b.name}? It stays off until you start it again.`)) return;
                      void run(() => serverPower(b.id, 'shutdown'));
                    }}
                  >
                    Shut down
                  </button>
                </div>
              </div>
            ) : null}

            <div className="border-t border-divider px-5 py-3">
              <div className="mb-2 font-mono text-xs text-muted">working on</div>
              {b.working.length === 0 ? (
                <div className="font-mono text-[13px] text-muted">idle</div>
              ) : (
                b.working.map((w) => (
                  <div key={w.id} className="flex flex-wrap items-baseline gap-x-3 py-0.5 font-mono text-[13px]">
                    <span>{w.order_number}</span>
                    <span className="text-muted">{w.account_label ?? ''}</span>
                    <span className="text-muted">{now ? timeAgo(w.claimed_at, now) : ''}</span>
                    {w.stuck ? <span className="text-warn">stuck</span> : null}
                  </div>
                ))
              )}
            </div>

            <div className="border-t border-divider px-5 py-3">
              <div className="mb-2 font-mono text-xs text-muted">accounts on this box ({b.accounts.length})</div>
              {b.accounts.length === 0 ? (
                <div className="font-mono text-[13px] text-muted">none assigned. assign accounts on the accounts page.</div>
              ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-x-6 gap-y-2">
                  {b.accounts.map((a) => (
                    <div key={a.id} className="flex items-start gap-2.5">
                      <span className="mt-[6px]">
                        <Dot color={a.status === 'paused' ? TONE.muted : a.status === 'locked' ? TONE.bad : sessionTone(a.session_state)} />
                      </span>
                      <div className="min-w-0">
                        <div className="font-mono text-[13px]">
                          {a.label}{' '}
                          <span className="text-muted">
                            {a.orders_today}/{a.daily_order_cap}
                          </span>
                        </div>
                        <div className="text-xs text-muted">{a.status === 'paused' ? 'paused' : a.status === 'locked' ? 'locked' : sessionLabel(a.session_state)}</div>
                        {a.last_error ? <div className="text-xs text-bad">{a.last_error}</div> : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            </div>
            ) : null}
          </div>
          );
        })}
        {pager}
      </Card>
      ) : null}
    </>
  );
}
