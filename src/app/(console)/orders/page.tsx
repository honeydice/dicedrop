import { OrdersView } from '@/components/console/OrdersView';
import { loadRpc } from '@/lib/load';
import type { OpsOrders } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function OrdersPage() {
  const { data, error } = await loadRpc<OpsOrders>('dd_ops_orders', { p_client: null });
  return <OrdersView initial={data} initialError={error} />;
}
