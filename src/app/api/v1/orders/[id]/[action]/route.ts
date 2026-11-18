import { NextResponse } from 'next/server';
import { apiError, authenticate, fromDbError, publicOrder } from '@/lib/apiAuth';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIONS = new Set(['cancel', 'hold', 'retry']);

/** POST /api/v1/orders/{id}/cancel | hold | retry */
export async function POST(req: Request, { params }: { params: { id: string; action: string } }) {
  try {
    const auth = authenticate(req);
    if (!auth.ok) return auth.response;

    if (!ACTIONS.has(params.action)) {
      return apiError(404, 'unknown_action', 'Use cancel, hold, or retry.');
    }
    if (!UUID.test(params.id)) return apiError(404, 'not_found', 'No order with that id.');

    const { data, error } = await auth.db.rpc('dd_api_order_action', {
      p_key: auth.key,
      p_id: params.id,
      p_action: params.action,
    });
    if (error) return fromDbError(error);

    return NextResponse.json({ order: publicOrder(data) });
  } catch {
    return apiError(500, 'server_error', 'Something went wrong.');
  }
}
