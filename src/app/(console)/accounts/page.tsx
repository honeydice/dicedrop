import { AccountsView } from '@/components/console/AccountsView';
import { loadRpc } from '@/lib/load';
import type { OpsAccounts } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function AccountsPage() {
  const { data, error } = await loadRpc<OpsAccounts>('dd_ops_accounts');
  return <AccountsView initial={data ?? { accounts: [], boxes: [], clients: [] }} initialError={error} />;
}
