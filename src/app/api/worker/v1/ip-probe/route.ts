import { NextResponse } from 'next/server';
import { apiError, authenticate, fromDbError } from '@/lib/apiAuth';

export const dynamic = 'force-dynamic';

/**
 * POST /api/worker/v1/ip-probe
 * A box reports the result of an IP-quality probe (reads a profile's proxy and checks it through ipapi.is,
 * without opening the browser). Body: the result object. Auth: "Authorization: Bearer ddbox_...".
 */
export async function POST(req: Request) {
  try {
    const auth = authenticate(req);
    if (!auth.ok) return auth.response;
    let result: Record<string, unknown> = {};
    try {
      const parsed = (await req.json()) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) result = parsed as Record<string, unknown>;
    } catch {
      // empty body is fine
    }
    const { data, error } = await auth.db.rpc('dd_worker_ip_probe', { p_token: auth.key, p_result: result });
    if (error) return fromDbError(error);
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return apiError(500, 'server_error', 'Something went wrong.');
  }
}
