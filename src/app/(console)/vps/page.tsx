import { VpsView } from '@/components/console/VpsView';
import { loadRpc } from '@/lib/load';
import { createClient } from '@/lib/supabase/server';
import type { OpsBoxes } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function VpsPage() {
  const { data, error } = await loadRpc<OpsBoxes>('dd_ops_boxes');
  let perBox = 5;
  try {
    const { data: s } = await createClient().from('platform_settings').select('accounts_per_box').eq('id', 1).maybeSingle();
    perBox = (s as { accounts_per_box: number } | null)?.accounts_per_box ?? 5;
  } catch {
    // Fall back to the default capacity.
  }
  return <VpsView perBox={perBox} initial={data ?? { boxes: [], queue: [], pending_total: 0, contabo: null }} initialError={error} />;
}
