import { redirect } from 'next/navigation';
import { setWorkspaceStatus } from '@/app/platform/actions';
import { Header } from '@/components/Header';
import { SetupNotice } from '@/components/SetupNotice';
import { getSessionContext } from '@/lib/context';
import { hasSupabaseEnv } from '@/lib/env';
import { money } from '@/lib/format';
import { createClient } from '@/lib/supabase/server';
import { VERSION } from '@/lib/version';

export const dynamic = 'force-dynamic';

interface Totals {
  workspaces: number;
  users: number;
  orders_total: number;
  orders_24h: number;
  spent_24h: number;
  open_issues: number;
  buyer_accounts: number;
  boxes_online: number;
  boxes_total: number;
}
interface WorkspaceRow {
  id: string;
  name: string;
  status: 'active' | 'paused';
  timezone: string;
  created_at: string;
  owner_email: string | null;
  members: number;
  orders_total: number;
  orders_24h: number;
  spent_24h: number;
  pending: number;
  issues: number;
  active_keys: number;
  last_api_use: string | null;
  buyer_accounts: number;
  boxes: number;
}
interface UserRow {
  id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
  confirmed: boolean;
  platform_owner: boolean;
  workspaces: string;
}
interface Overview {
  totals: Totals;
  workspaces: WorkspaceRow[];
  users: UserRow[];
}

function when(iso: string | null): string {
  if (!iso) return 'Never';
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex-1 basis-44 rounded-xl border border-line bg-panel px-5 py-4">
      <div className="text-xs font-medium uppercase tracking-wider text-muted">{label}</div>
      <div className="mt-1.5 font-display text-3xl font-semibold tracking-tight">{value}</div>
      {hint ? <div className="mt-1 text-xs text-muted">{hint}</div> : null}
    </div>
  );
}

const th = 'px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-muted';
const td = 'px-3 py-2.5 align-middle';

export default async function PlatformPage() {
  if (!hasSupabaseEnv()) return <SetupNotice />;

  const ctx = await getSessionContext();
  if (!ctx) redirect('/login');
  if (!ctx.isPlatformAdmin) redirect('/');

  let data: Overview | null = null;
  let loadError = '';
  try {
    const supabase = createClient();
    const { data: overview, error } = await supabase.rpc('dd_platform_overview');
    if (error) loadError = error.message;
    else data = overview as Overview;
  } catch {
    loadError = 'Could not load the platform view. Refresh to try again.';
  }

  const t = data?.totals;

  return (
    <div className="min-h-screen">
      <Header
        workspaceName={ctx.workspace?.name ?? 'Platform'}
        email={ctx.email}
        current="platform"
        isPlatformAdmin
      />
      <main className="mx-auto max-w-[1280px] space-y-5 px-5 pb-10 pt-6 sm:px-8">
        <div>
          <h1 className="font-display text-[28px] font-semibold tracking-tight">Platform</h1>
          <p className="mt-1 text-[13px] text-muted">
            The owner view of DiceDrop: every workspace, every user, and the whole system at a glance. Only platform
            owners see this page.
          </p>
        </div>

        {loadError ? (
          <div role="alert" className="rounded-lg border border-dangerline bg-dangerbg px-4 py-3 text-[13px] text-bad">
            {loadError}
          </div>
        ) : null}

        {t ? (
          <section aria-label="Totals" className="flex flex-wrap gap-3">
            <Tile label="Workspaces" value={String(t.workspaces)} hint={`${t.users} users`} />
            <Tile label="Orders, last 24h" value={String(t.orders_24h)} hint={`${t.orders_total} all time`} />
            <Tile label="Spent, last 24h" value={money(Number(t.spent_24h))} hint="Across every workspace" />
            <Tile label="Open issues" value={String(t.open_issues)} hint="Orders needing attention" />
            <Tile
              label="Boxes online"
              value={`${t.boxes_online} / ${t.boxes_total}`}
              hint={`${t.buyer_accounts} buyer accounts`}
            />
          </section>
        ) : null}

        <section className="rounded-xl border border-line bg-panel p-5">
          <h2 className="font-display text-lg font-semibold">Workspaces</h2>
          <p className="mt-1 text-[13px] text-muted">
            Each customer is one workspace. Pausing a workspace stops its API keys from sending orders until you resume it.
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[980px] border-collapse">
              <thead>
                <tr className="border-b border-line">
                  <th className={th}>Workspace</th>
                  <th className={th}>Status</th>
                  <th className={th}>Orders 24h</th>
                  <th className={th}>Spent 24h</th>
                  <th className={th}>Pending</th>
                  <th className={th}>Issues</th>
                  <th className={th}>Keys</th>
                  <th className={th}>Accounts</th>
                  <th className={th}>Last API call</th>
                  <th className={th} />
                </tr>
              </thead>
              <tbody>
                {(data?.workspaces ?? []).map((w) => (
                  <tr key={w.id} className="border-b border-divider last:border-b-0">
                    <td className={td}>
                      <div className="font-medium">{w.name}</div>
                      <div className="mt-0.5 text-xs text-muted">
                        {w.owner_email ?? 'No owner'} · {w.members} {w.members === 1 ? 'member' : 'members'} · since{' '}
                        {when(w.created_at)}
                      </div>
                    </td>
                    <td className={td} style={{ color: w.status === 'active' ? 'rgb(var(--good))' : 'rgb(var(--warn))' }}>
                      {w.status === 'active' ? 'Active' : 'Paused'}
                    </td>
                    <td className={`${td} font-mono text-[13px]`}>
                      {w.orders_24h}
                      <span className="text-muted"> / {w.orders_total}</span>
                    </td>
                    <td className={`${td} font-mono text-[13px]`}>{money(Number(w.spent_24h))}</td>
                    <td className={`${td} font-mono text-[13px]`}>{w.pending}</td>
                    <td className={`${td} font-mono text-[13px]`} style={{ color: w.issues > 0 ? 'rgb(var(--bad))' : undefined }}>
                      {w.issues}
                    </td>
                    <td className={`${td} font-mono text-[13px]`}>{w.active_keys}</td>
                    <td className={`${td} font-mono text-[13px]`}>{w.buyer_accounts}</td>
                    <td className={`${td} text-muted`}>{when(w.last_api_use)}</td>
                    <td className={`${td} text-right`}>
                      <form action={setWorkspaceStatus}>
                        <input type="hidden" name="id" value={w.id} />
                        <input type="hidden" name="status" value={w.status === 'active' ? 'paused' : 'active'} />
                        <button
                          type="submit"
                          className="min-h-[44px] rounded-lg border border-edge bg-raised px-3.5 text-[13px] font-medium text-fg"
                        >
                          {w.status === 'active' ? 'Pause' : 'Resume'}
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-xl border border-line bg-panel p-5">
          <h2 className="font-display text-lg font-semibold">Users</h2>
          <p className="mt-1 text-[13px] text-muted">Everyone with a DiceDrop login.</p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse">
              <thead>
                <tr className="border-b border-line">
                  <th className={th}>Email</th>
                  <th className={th}>Workspaces</th>
                  <th className={th}>Signed up</th>
                  <th className={th}>Last sign-in</th>
                  <th className={th}>Role</th>
                </tr>
              </thead>
              <tbody>
                {(data?.users ?? []).map((u) => (
                  <tr key={u.id} className="border-b border-divider last:border-b-0">
                    <td className={`${td} font-medium`}>
                      {u.email}
                      {u.confirmed ? null : <span className="ml-2 text-xs text-warn">unconfirmed</span>}
                    </td>
                    <td className={`${td} text-soft`}>{u.workspaces || 'None yet'}</td>
                    <td className={`${td} text-muted`}>{when(u.created_at)}</td>
                    <td className={`${td} text-muted`}>{when(u.last_sign_in_at)}</td>
                    <td className={td} style={{ color: u.platform_owner ? 'rgb(var(--accent))' : 'rgb(var(--muted))' }}>
                      {u.platform_owner ? 'Platform owner' : 'Customer'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <p className="text-xs text-muted">DiceDrop v{VERSION}</p>
      </main>
    </div>
  );
}
