import { NextResponse } from 'next/server';
import { apiError, authenticate, fromDbError, publicOrder } from '@/lib/apiAuth';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET /api/v1/orders/{id} : status, Amazon order #, cost, and tracking for one order. */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const auth = authenticate(req);
    if (!auth.ok) return auth.response;

    // An order answers to its DiceDrop number (DD-100042) as well as its id.
    const byNumber = /^DD-\d+$/i.test(params.id);
    if (!byNumber && !UUID.test(params.id)) return apiError(404, 'not_found', 'No order with that id.');

    const { data, error } = byNumber
      ? await auth.db.rpc('dd_api_get_order_by_number', { p_key: auth.key, p_number: params.id.toUpperCase() })
      : await auth.db.rpc('dd_api_get_order', { p_key: auth.key, p_id: params.id });
    if (error) return fromDbError(error);

    // The client sees the order's milestones and its good pictures. What went wrong on the way stays with the operator.
    const order = publicOrder(data.order);
    const bought = ['ordered', 'shipped', 'delivered'].includes(order.status);
    const SHOWN = ['received', 'created', 'sent_again', 'cancel', 'linked_by_hand', 'shipped'];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const events = (Array.isArray(data.events) ? data.events : []).filter((e: any) => SHOWN.includes(e.type)).map((e: any) => ({ type: e.type, created_at: e.created_at }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const proofs = bought ? (Array.isArray(data.proofs) ? data.proofs : []).filter((p: any) => ['ordered', 'shipped', 'delivered'].includes(p.kind)) : [];
    const shipment = data.shipment ? { ...data.shipment, status: order.status } : null;
    return NextResponse.json({ order, events, shipment, proofs });
  } catch {
    return apiError(500, 'server_error', 'Something went wrong.');
  }
}
