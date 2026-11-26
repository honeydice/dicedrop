import { AccountsView } from '@/components/console/AccountsView';
import { loadRpc } from '@/lib/load';
import type { OpsAccounts, OpsDataUsage } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function AccountsPage() {
  const [{ data, error }, usage] = await Promise.all([
    loadRpc<OpsAccounts>('dd_ops_accounts'),
    loadRpc<OpsDataUsage>('dd_ops_data_usage'),
  ]);
  return (
    <AccountsView
      initial={data ?? { accounts: [], boxes: [], clients: [], cards: [], totp_expires_in: 30 }}
      initialError={error}
      dataUsage={usage.data ?? null}
    />
  );
}
