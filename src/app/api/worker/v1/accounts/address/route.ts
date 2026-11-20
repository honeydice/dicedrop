import { NextResponse } from 'next/server';
import { apiError, authenticate, fromDbError } from '@/lib/apiAuth';

export const dynamic = 'force-dynamic';

/**
 * POST /api/worker/v1/accounts/address   { "account": "AMZ-01", "ip": "1.2.3.4", "info": "Charter Communications · Ashburn, Virginia, US" }
 * A box saves who an account's outgoing (proxy) address belongs to.
 */
export async function POST(req: Request) {
  try {
    const auth = authenticate(req);
    if (!auth.ok) return auth.response;
    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return apiError(400, 'invalid_json', 'The request body must be JSON.');
    }
    const account = typeof body.account === 'string' ? body.account.trim() : '';
    const ip = typeof body.ip === 'string' ? body.ip.trim() : '';
    if (!account || !ip) return apiError(422, 'missing_fields', 'Send "account" and "ip".');
    const { error } = await auth.db.rpc('dd_worker_ip_info', { p_token: auth.key, p_label: account, p_ip: ip, p_info: typeof body.info === 'string' ? body.info : '' });
    if (error) return fromDbError(error);
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return apiError(500, 'server_error', 'Something went wrong.');
  }
}
