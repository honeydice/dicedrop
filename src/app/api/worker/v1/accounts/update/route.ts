import { NextResponse } from 'next/server';
import { apiError, authenticate, fromDbError } from '@/lib/apiAuth';

export const dynamic = 'force-dynamic';

/**
 * POST /api/worker/v1/accounts/update   { "account": "AMZ-01", ... }
 * A box works on one of its own accounts, with "Authorization: Bearer ddbox_...".
 * secrets: returns the login, password, and dedicated proxy the box needs to sign that account in.
 * update: reports the Kameleo profile id, sign-in state, a note, the outgoing IP, and a screenshot.
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

    const { data, error } = await auth.db.rpc('dd_worker_account_update', { p_token: auth.key, p_label: account, p: body });
    if (error) return fromDbError(error);
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return apiError(500, 'server_error', 'Something went wrong.');
  }
}
