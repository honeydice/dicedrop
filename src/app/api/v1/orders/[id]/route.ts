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

    return NextResponse.json({ order: publicOrder(data.order), events: data.events ?? [], shipment: data.shipment ?? null, proofs: data.proofs ?? [] });
  } catch {
    return apiError(500, 'server_error', 'Something went wrong.');
  }
}
