import { NextResponse } from 'next/server';
import { apiError, authenticate, fromDbError } from '@/lib/apiAuth';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/worker/v1/orders/{id}/progress
 * details: the box asks for the item and ship-to of an order it has been handed.
 * progress: the box reports a note, a screenshot, the checkout totals, and whether the run is done.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const auth = authenticate(req);
    if (!auth.ok) return auth.response;
    if (!UUID.test(params.id)) return apiError(404, 'not_found', 'No order with that id.');

    let body: Record<string, unknown> = {};
    try {
      const parsed = (await req.json()) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
    } catch {
      // An empty body is fine.
    }

    const { data, error } = await auth.db.rpc('dd_worker_order_progress', { p_token: auth.key, p_order: params.id, p: body });
    if (error) return fromDbError(error);
    void body;
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return apiError(500, 'server_error', 'Something went wrong.');
  }
}
