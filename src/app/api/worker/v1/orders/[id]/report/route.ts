import { NextResponse } from 'next/server';
import { apiError, authenticate, fromDbError } from '@/lib/apiAuth';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TYPES = new Set(['placed', 'issue', 'release', 'shipped', 'delivered', 'cancelled']);

/**
 * POST /api/worker/v1/orders/{id}/report
 * A box reports what happened to an order it holds.
 *   { type: 'placed', amazon_order_id, buy_cost, buy_tax }
 *   { type: 'issue', reason, screenshot_url?, account_state? }
 *   { type: 'release' }                      give the order back to the queue
 *   { type: 'shipped', tracking_number, carrier }
 *   { type: 'delivered' }
 *   { type: 'cancelled' }
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const auth = authenticate(req);
    if (!auth.ok) return auth.response;

    if (!UUID.test(params.id)) return apiError(404, 'not_found', 'No order with that id.');

    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return apiError(400, 'invalid_json', 'The request body must be JSON.');
    }
    if (typeof body.type !== 'string' || !TYPES.has(body.type)) {
      return apiError(422, 'invalid_type', 'type must be placed, issue, release, shipped, delivered, or cancelled.');
    }

    const { data, error } = await auth.db.rpc('dd_worker_report', { p_token: auth.key, p_order: params.id, p_result: body });
    if (error) return fromDbError(error);
    return NextResponse.json(data);
  } catch {
    return apiError(500, 'server_error', 'Something went wrong.');
  }
}
