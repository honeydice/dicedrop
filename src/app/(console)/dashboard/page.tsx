import { OverviewView } from '@/components/console/OverviewView';
import { loadRpc } from '@/lib/load';
import type { OpsOverview } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function OverviewPage() {
  const { data, error } = await loadRpc<OpsOverview>('dd_ops_overview');
  return <OverviewView initial={data} initialError={error} />;
}
