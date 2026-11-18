'use client';

import Link from 'next/link';
import { money, timeAgo } from '@/lib/format';
import type { OpsOverview } from '@/lib/types';
import { Badge, Card, Dot, ErrorNote, PageHead, Tile, TONE, td, th } from './ui';
import { useLive, useNow } from './useLive';

function wait(minutes: number | null): string {
  if (minutes === null || minutes === undefined) return 'nothing waiting';
  if (minutes < 1) return 'oldest: under a minute';
  if (minutes < 60) return `oldest: ${minutes}m`;
  return `oldest: ${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function OverviewView({ initial, initialError }: { initial: OpsOverview | null; initialError: string }) {
  const { data, error } = useLive<OpsOverview | null>('dd_ops_overview', undefined, initial, initialError);
  const now = useNow();

  if (!data) {
    return (
      <>
        <PageHead title="Overview" />
        <ErrorNote message={error || 'Loading.'} />
      </>
    );
  }

  const o = data.orders;
  const offline = data.boxes.total - data.boxes.online;

  // What needs attention right now, most urgent first.
  const concerns: { text: string; href: string }[] = [];
  if (o.stuck > 0) concerns.push({ text: `${o.stuck} order${o.stuck === 1 ? '' : 's'} stuck in ordering for over 10 minutes`, href: '/orders' });
  if (offline > 0) concerns.push({ text: `${offline} box${offline === 1 ? '' : 'es'} not connecting`, href: '/vps' });
  if (data.accounts.attention > 0)
    concerns.push({ text: `${data.accounts.attention} account${data.accounts.attention === 1 ? '' : 's'} need attention`, href: '/accounts' });
  if (o.issues > 0) concerns.push({ text: `${o.issues} order${o.issues === 1 ? '' : 's'} flagged with an issue`, href: '/orders' });
  if (o.pending > 0 && data.accounts.ready === 0)
    concerns.push({ text: `${o.pending} order${o.pending === 1 ? '' : 's'} waiting and no account is ready to place them`, href: '/vps' });

  const healthy = concerns.length === 0;
  const peak = Math.max(1, ...data.hourly.map((h) => Math.max(h.received, h.placed)));

  return (
    <>
      <PageHead title="Overview" hint="The health of the whole system, refreshed every 10 seconds." />
      <ErrorNote message={error} />

      <div
        className="mb-5 rounded-2xl border px-5 py-4"
        style={{ borderColor: healthy ? 'rgb(var(--good) / 0.4)' : 'rgb(var(--warn) / 0.5)' }}
      >
        <div className="flex items-center gap-3 font-mono text-[15px]">
          <Dot color={healthy ? TONE.good : TONE.warn} />
          {healthy ? 'system.healthy' : 'system.needs_attention'}
        </div>
        {healthy ? (
          <div className="mt-1 pl-[22px] text-[13px] text-muted">Nothing needs you right now.</div>
        ) : (
          <ul className="mt-2 space-y-1 pl-[22px]">
            {concerns.map((c) => (
              <li key={c.text} className="text-[13px]">
                <Link href={c.href} className="text-fg underline decoration-line underline-offset-4 hover:text-strong">
                  {c.text}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <section aria-label="Order flow" className="mb-3 flex flex-wrap gap-3">
        <Tile label="Pending" value={String(o.pending)} hint={wait(o.oldest_pending_minutes)} tone="accent" />
        <Tile label="Ordering now" value={String(o.ordering)} hint={o.stuck > 0 ? `${o.stuck} stuck` : 'in checkout'} tone={o.stuck > 0 ? 'warn' : undefined} />
        <Tile label="Issues" value={String(o.issues)} hint={`${o.held} on hold`} tone={o.issues > 0 ? 'bad' : undefined} />
        <Tile label="Placed, last 24h" value={String(o.placed_24h)} hint={`${o.received_24h} received`} />
        <Tile label="Spent today" value={money(Number(o.spent_today))} hint={`${o.awaiting_tracking} awaiting tracking`} />
      </section>
      <section aria-label="Infrastructure" className="mb-5 flex flex-wrap gap-3">
        <Tile
          label="Boxes online"
          value={`${data.boxes.online} / ${data.boxes.total}`}
          hint={data.boxes.paused > 0 ? `${data.boxes.paused} paused or draining` : 'all set to run'}
          tone={offline > 0 ? 'warn' : data.boxes.total > 0 ? 'good' : undefined}
        />
        <Tile
          label="Accounts ready"
          value={`${data.accounts.ready} / ${data.accounts.total}`}
          hint={`${data.accounts.attention} need attention · ${data.accounts.unassigned} unassigned`}
          tone={data.accounts.attention > 0 ? 'warn' : data.accounts.ready > 0 ? 'good' : undefined}
        />
      </section>

      <div className="mb-5">
        <Card title="orders.received, last 24 hours" right={<Badge>{o.received_24h}</Badge>}>
          <div className="flex h-28 items-end gap-1 px-5 pb-3 pt-4" role="img" aria-label={`${o.received_24h} orders received in the last 24 hours`}>
            {data.hourly.map((h) => (
              <div
                key={h.hour}
                className="flex-1 rounded-t bg-accent/70"
                style={{ height: `${Math.max(3, (h.received / peak) * 100)}%`, opacity: h.received === 0 ? 0.25 : 1 }}
                title={`${new Date(h.hour).toLocaleTimeString('en-US', { hour: 'numeric' })}: ${h.received} received, ${h.placed} placed`}
              />
            ))}
          </div>
          <div className="flex justify-between px-5 pb-3 font-mono text-[11px] text-muted">
            <span>24h ago</span>
            <span>now</span>
          </div>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="who is ordering" right={<Badge>{data.clients.length}</Badge>}>
          {data.clients.length === 0 ? (
            <div className="px-5 py-8 text-center font-mono text-[13px] text-muted">no clients yet. add one under clients.</div>
          ) : (
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-line">
                  <th className={th}>Client</th>
                  <th className={th}>24h</th>
                  <th className={th}>Pending</th>
                  <th className={th}>Issues</th>
                  <th className={th}>Last order</th>
                </tr>
              </thead>
              <tbody>
                {data.clients.map((c) => (
                  <tr key={c.id} className="border-b border-divider last:border-b-0">
                    <td className={`${td} font-medium`}>
                      {c.name}
                      {c.status === 'paused' ? <span className="ml-2 text-xs text-warn">paused</span> : null}
                    </td>
                    <td className={`${td} font-mono text-[13px]`}>{c.orders_24h}</td>
                    <td className={`${td} font-mono text-[13px]`}>{c.pending}</td>
                    <td className={`${td} font-mono text-[13px]`} style={{ color: c.issues > 0 ? TONE.bad : undefined }}>
                      {c.issues}
                    </td>
                    <td className={`${td} font-mono text-xs text-muted`}>{c.last_order_at && now ? timeAgo(c.last_order_at, now) : 'never'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="recent issues" right={<Badge>{o.issues}</Badge>}>
          {data.issues.length === 0 ? (
            <div className="px-5 py-8 text-center font-mono text-[13px] text-muted">no open issues.</div>
          ) : (
            data.issues.map((i) => (
              <div key={i.id} className="flex items-start gap-3.5 border-b border-divider px-5 py-3 last:border-b-0">
                <span className="mt-[7px]">
                  <Dot color="var(--st-issue-fg)" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-3 font-mono text-[14px]">
                    <span>order.issue</span>
                    <span className="text-[13px] text-muted">{i.order_number}</span>
                  </div>
                  <div className="mt-0.5 text-[13px] text-bad">{i.issue_reason}</div>
                  <div className="mt-0.5 text-xs text-muted">
                    {[i.client_name, i.account_label, i.box_name].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <div className="shrink-0 font-mono text-[13px] text-muted">{now ? timeAgo(i.updated_at, now) : ''}</div>
              </div>
            ))
          )}
        </Card>
      </div>
    </>
  );
}
