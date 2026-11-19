import { NextResponse } from 'next/server';
import { apiError, authenticate, fromDbError } from '@/lib/apiAuth';

export const dynamic = 'force-dynamic';

/**
 * POST /api/worker/v1/accounts/access   { "account": "AMZ-01", "reason": "order check", "ok": true, "result": "...", "exit_ip": "...", "seconds": 42 }
 * A box records one line in an account's access log each time it opens that account's browser.
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
    if (!account) return apiError(422, 'missing_fields', 'Send the account label as "account".');

    const { error } = await auth.db.rpc('dd_worker_account_access', {
      p_token: auth.key,
      p_label: account,
      p_reason: typeof body.reason === 'string' ? body.reason.slice(0, 120) : 'session',
      p_ok: body.ok !== false,
      p_result: typeof body.result === 'string' ? body.result.slice(0, 600) : null,
      p_exit_ip: typeof body.exit_ip === 'string' ? body.exit_ip.slice(0, 45) : null,
      p_seconds: typeof body.seconds === 'number' && Number.isFinite(body.seconds) ? Math.round(body.seconds) : null,
    });
    if (error) return fromDbError(error);
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return apiError(500, 'server_error', 'Something went wrong.');
  }
}
