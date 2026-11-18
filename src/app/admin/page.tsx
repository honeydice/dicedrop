import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { revokeApiKey } from '@/app/admin/actions';
import { AccountForm } from '@/components/admin/AccountForm';
import { ApiKeyForm } from '@/components/admin/ApiKeyForm';
import { ThemeToggle } from '@/components/admin/ThemeToggle';
import { Header } from '@/components/Header';
import { SetupNotice } from '@/components/SetupNotice';
import { getSessionContext } from '@/lib/context';
import { hasSupabaseEnv } from '@/lib/env';
import { cardLabel } from '@/lib/format';
import { createClient } from '@/lib/supabase/server';
import { VERSION } from '@/lib/version';

export const dynamic = 'force-dynamic';

interface ApiKeyRow {
  id: string;
  name: string;
  key_prefix: string;
  webhook_url: string | null;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}
interface AccountRow {
  id: string;
  label: string;
  login_email: string | null;
  status: string;
  daily_order_cap: number;
  proxy_label: string | null;
  card_bank: string | null;
  card_last4: string | null;
}
interface BoxRow {
  id: string;
  name: string;
  status: string;
  worker_version: string | null;
  last_heartbeat: string | null;
}
interface SelectorRow {
  key: string;
  value: string;
  description: string | null;
}

function day(iso: string | null): string {
  if (!iso) return 'Never';
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-panel p-5">
      <h2 className="font-display text-lg font-semibold">{title}</h2>
      <p className="mt-1 text-[13px] text-muted">{hint}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

const th = 'px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-muted';
const td = 'px-3 py-2.5 align-middle';

export default async function AdminPage() {
  if (!hasSupabaseEnv()) return <SetupNotice />;

  const ctx = await getSessionContext();
  if (!ctx) redirect('/login');
  if (!ctx.workspace) redirect('/setup');

  const isOwner = ctx.role === 'owner';
  let keys: ApiKeyRow[] = [];
  let accounts: AccountRow[] = [];
  let boxes: BoxRow[] = [];
  let selectors: SelectorRow[] = [];
  let loadError = '';

  try {
    const supabase = createClient();
    const ws = ctx.workspace.id;
    const [k, a, b, s] = await Promise.all([
      supabase
        .from('api_keys')
        .select('id, name, key_prefix, webhook_url, created_at, last_used_at, revoked_at')
        .eq('workspace_id', ws)
        .order('created_at', { ascending: false }),
      supabase
        .from('buyer_accounts')
        .select('id, label, login_email, status, daily_order_cap, proxy_label, card_bank, card_last4')
        .eq('workspace_id', ws)
        .order('label', { ascending: true }),
      supabase
        .from('boxes')
        .select('id, name, status, worker_version, last_heartbeat')
        .eq('workspace_id', ws)
        .order('name', { ascending: true }),
      supabase.from('selectors').select('key, value, description').order('key', { ascending: true }),
    ]);
    keys = (k.data as ApiKeyRow[] | null) ?? [];
    accounts = (a.data as AccountRow[] | null) ?? [];
    boxes = (b.data as BoxRow[] | null) ?? [];
    selectors = (s.data as SelectorRow[] | null) ?? [];
    loadError = k.error?.message ?? a.error?.message ?? b.error?.message ?? s.error?.message ?? '';
  } catch {
    loadError = 'Could not load the admin data. Refresh to try again.';
  }

  const host = headers().get('host') ?? 'your-dicedrop-domain.com';
  const base = `https://${host}`;
  const snippet = `// Send an order to DiceDrop
const res = await fetch('${base}/api/v1/orders', {
  method: 'POST',
  headers: {
    'Authorization': \`Bearer \${process.env.DICEDROP_API_KEY}\`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    order_number: '22-15411-33373',   // your order #
    line_id: '10085630888922',        // optional, for multi-item orders
    store_code: 'CA009',
    title: 'Watercolor Paint Brushes 12Pcs',
    asin: 'B0XXXXXXXX',               // or buy_url
    quantity: 1,
    sale_price: 19.99,
    sale_fees: 3.10,
    est_cost: 11.50,                  // optional, powers the pending estimate
    buyer: { name: 'Jane Buyer', username: 'jane_buyer' },
    ship_to: {
      name: 'Jane Buyer',
      line1: '100 Example St',
      line2: '',
      city: 'Austin',
      state: 'TX',
      postal_code: '73301',
      phone: '5125550100',
    },
  }),
});
const { order } = await res.json();   // order.id, order.status

// Later
// GET  ${base}/api/v1/orders/{id}
// POST ${base}/api/v1/orders/{id}/cancel   (or /hold, /retry)`;

  return (
    <div className="min-h-screen">
      <Header
        workspaceName={ctx.workspace.name}
        email={ctx.email}
        current="admin"
        isPlatformAdmin={ctx.isPlatformAdmin}
      />
      <main className="mx-auto max-w-[1100px] space-y-5 px-5 pb-10 pt-6 sm:px-8">
        <h1 className="font-display text-[28px] font-semibold tracking-tight">Admin</h1>

        {loadError ? (
          <div role="alert" className="rounded-lg border border-dangerline bg-dangerbg px-4 py-3 text-[13px] text-bad">
            {loadError}
          </div>
        ) : null}

        <Section title="Settings" hint="How DiceDrop looks on this device.">
          <ThemeToggle />
        </Section>

        <Section title="API keys" hint="One key per connected app. Paste the key into the app, add the snippet below, and it is live.">
          {isOwner ? <ApiKeyForm /> : <p className="text-muted">Only the workspace owner manages API keys.</p>}
          {keys.length > 0 ? (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse">
                <thead>
                  <tr className="border-b border-line">
                    <th className={th}>Name</th>
                    <th className={th}>Key</th>
                    <th className={th}>Last used</th>
                    <th className={th}>Status</th>
                    <th className={th} />
                  </tr>
                </thead>
                <tbody>
                  {keys.map((key) => (
                    <tr key={key.id} className="border-b border-divider last:border-b-0">
                      <td className={`${td} font-medium`}>{key.name}</td>
                      <td className={`${td} font-mono text-xs text-soft`}>{key.key_prefix}…</td>
                      <td className={`${td} text-muted`}>{day(key.last_used_at)}</td>
                      <td className={td} style={{ color: key.revoked_at ? 'rgb(var(--muted))' : 'rgb(var(--good))' }}>
                        {key.revoked_at ? 'Switched off' : 'Active'}
                      </td>
                      <td className={`${td} text-right`}>
                        {!key.revoked_at && isOwner ? (
                          <form action={revokeApiKey}>
                            <input type="hidden" name="id" value={key.id} />
                            <button
                              type="submit"
                              className="min-h-[44px] rounded-lg border border-dangerline bg-raised px-3.5 text-[13px] font-medium text-bad"
                            >
                              Switch off
                            </button>
                          </form>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </Section>

        <Section title="Connect an app" hint="The standard snippet. Any app plugs in the same way.">
          <pre className="overflow-x-auto rounded-lg border border-line bg-ink p-4 font-mono text-xs leading-relaxed text-soft">
            {snippet}
          </pre>
        </Section>

        <Section title="Buyer accounts" hint="The Amazon accounts that place orders. Logins are added securely when the Worker comes online.">
          {isOwner ? <AccountForm /> : null}
          {accounts.length > 0 ? (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse">
                <thead>
                  <tr className="border-b border-line">
                    <th className={th}>Label</th>
                    <th className={th}>Login</th>
                    <th className={th}>Status</th>
                    <th className={th}>Orders / day</th>
                    <th className={th}>Card</th>
                    <th className={th}>Proxy</th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((acct) => (
                    <tr key={acct.id} className="border-b border-divider last:border-b-0">
                      <td className={`${td} font-medium`}>{acct.label}</td>
                      <td className={`${td} text-soft`}>{acct.login_email ?? '—'}</td>
                      <td className={`${td} capitalize text-soft`}>{acct.status}</td>
                      <td className={`${td} font-mono text-[13px]`}>{acct.daily_order_cap}</td>
                      <td className={`${td} text-soft`}>{cardLabel(acct.card_bank, acct.card_last4)}</td>
                      <td className={`${td} text-soft`}>{acct.proxy_label ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-4 text-muted">No buyer accounts yet.</p>
          )}
        </Section>

        <Section title="Boxes" hint="Worker servers check in here on their own once the Worker is installed.">
          {boxes.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] border-collapse">
                <thead>
                  <tr className="border-b border-line">
                    <th className={th}>Box</th>
                    <th className={th}>Status</th>
                    <th className={th}>Worker version</th>
                    <th className={th}>Last heartbeat</th>
                  </tr>
                </thead>
                <tbody>
                  {boxes.map((box) => (
                    <tr key={box.id} className="border-b border-divider last:border-b-0">
                      <td className={`${td} font-medium`}>{box.name}</td>
                      <td className={`${td} capitalize text-soft`}>{box.status}</td>
                      <td className={`${td} font-mono text-xs text-soft`}>{box.worker_version ?? '—'}</td>
                      <td className={`${td} text-muted`}>{day(box.last_heartbeat)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-muted">No boxes yet. They appear here when Worker v1 starts.</p>
          )}
        </Section>

        <Section title="Selectors" hint="Where Amazon's buttons and fields live. A page change on Amazon becomes a one-row edit here.">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse">
              <thead>
                <tr className="border-b border-line">
                  <th className={th}>Key</th>
                  <th className={th}>Selector</th>
                  <th className={th}>What it finds</th>
                </tr>
              </thead>
              <tbody>
                {selectors.map((sel) => (
                  <tr key={sel.key} className="border-b border-divider last:border-b-0">
                    <td className={`${td} font-mono text-xs`}>{sel.key}</td>
                    <td className={`${td} font-mono text-xs text-accent`}>{sel.value}</td>
                    <td className={`${td} text-soft`}>{sel.description ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <p className="text-xs text-muted">DiceDrop v{VERSION}</p>
      </main>
    </div>
  );
}
