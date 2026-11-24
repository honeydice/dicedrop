import { NextResponse } from 'next/server';
import { apiError, authenticate, fromDbError } from '@/lib/apiAuth';

export const dynamic = 'force-dynamic';

/**
 * POST /api/worker/v1/heartbeat
 * A box checks in with "Authorization: Bearer ddbox_...", reports its state, and gets its instructions back:
 * desired_state (run | pause | drain), its accounts, and the current selectors.
 * Body (all optional): { version, hostname, state, error, accounts: [{ label, session_state, error }] }
 */
export async function POST(req: Request) {
  try {
    const auth = authenticate(req);
    if (!auth.ok) return auth.response;

    let payload: Record<string, unknown> = {};
    try {
      const parsed = (await req.json()) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) payload = parsed as Record<string, unknown>;
    } catch {
      // An empty body is a valid heartbeat.
    }

    const { data, error } = await auth.db.rpc('dd_worker_heartbeat', { p_token: auth.key, p_payload: payload });
    if (error) return fromDbError(error);
    // The IP-quality gate key is never stored in the DB or sent to the console — the box reads it here only.
    const out = (data && typeof data === 'object' && !Array.isArray(data)) ? { ...data as Record<string, unknown>, ipapi_key: process.env.IPAPI_KEY || null } : data;
    return NextResponse.json(out);
  } catch {
    return apiError(500, 'server_error', 'Something went wrong.');
  }
}
