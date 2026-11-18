import { NextResponse } from 'next/server';
import { apiError, authenticate, fromDbError } from '@/lib/apiAuth';

export const dynamic = 'force-dynamic';

/**
 * POST /api/worker/v1/claim
 * A box asks for its next order. Returns { order, account } when one is assigned,
 * or { order: null, reason } when there is nothing to do
 * (box_pause, box_drain, no_free_account, queue_empty).
 */
export async function POST(req: Request) {
  try {
    const auth = authenticate(req);
    if (!auth.ok) return auth.response;

    const { data, error } = await auth.db.rpc('dd_worker_claim', { p_token: auth.key });
    if (error) return fromDbError(error);
    return NextResponse.json(data);
  } catch {
    return apiError(500, 'server_error', 'Something went wrong.');
  }
}
