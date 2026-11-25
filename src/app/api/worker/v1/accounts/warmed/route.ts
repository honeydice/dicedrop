import { NextResponse } from 'next/server';
import { apiError, authenticate, fromDbError } from '@/lib/apiAuth';

export const dynamic = 'force-dynamic';

/**
 * POST /api/worker/v1/accounts/warmed   { "account": "AMZ-01", ... }
 * A box reports that a warm-up browsing session finished (or why it could not run).
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

    const { data, error } = await auth.db.rpc('dd_worker_warmup_done', {
      p_token: auth.key,
      p_label: account,
      p_error: typeof body.error === 'string' ? body.error.slice(0, 400) : null,
      p_google: body.google === 'clean' || body.google === 'captcha' ? body.google : null,
    });
    if (error) return fromDbError(error);
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return apiError(500, 'server_error', 'Something went wrong.');
  }
}
