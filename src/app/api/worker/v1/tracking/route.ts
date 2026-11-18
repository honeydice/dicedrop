import { NextResponse } from 'next/server';
import { apiError, authenticate, fromDbError } from '@/lib/apiAuth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/worker/v1/tracking
 * Orders this box placed that still need a shipping or delivery check.
 */
export async function GET(req: Request) {
  try {
    const auth = authenticate(req);
    if (!auth.ok) return auth.response;

    const { data, error } = await auth.db.rpc('dd_worker_tracking', { p_token: auth.key });
    if (error) return fromDbError(error);
    return NextResponse.json({ orders: Array.isArray(data) ? data : [] });
  } catch {
    return apiError(500, 'server_error', 'Something went wrong.');
  }
}
