import { headers } from 'next/headers';
import { ClientsView } from '@/components/console/ClientsView';
import { loadRpc } from '@/lib/load';
import type { OpsClient } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function ClientsPage() {
  const { data, error } = await loadRpc<OpsClient[]>('dd_ops_clients');
  const host = headers().get('host') ?? 'your-dicedrop-domain.com';
  return <ClientsView initial={data ?? []} initialError={error} baseUrl={`https://${host}`} />;
}
