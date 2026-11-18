import { VpsView } from '@/components/console/VpsView';
import { loadRpc } from '@/lib/load';
import type { OpsBoxes } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function VpsPage() {
  const { data, error } = await loadRpc<OpsBoxes>('dd_ops_boxes');
  return <VpsView initial={data ?? { boxes: [], queue: [], pending_total: 0, contabo: null }} initialError={error} />;
}
