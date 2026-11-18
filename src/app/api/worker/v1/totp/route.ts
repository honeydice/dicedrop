import { NextResponse } from 'next/server';
import { apiError, authenticate, fromDbError } from '@/lib/apiAuth';

export const dynamic = 'force-dynamic';

/**
 * POST /api/worker/v1/totp   { "account": "AMZ-01" }
 * A box asks for the current two-step code of one of its own accounts.
 * Returns { account, code, expires_in }. The box receives the 6 digits only; the key never leaves the database.
 * If expires_in is under ~3 seconds, wait and ask again so the code does not expire mid-typing.
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

    const { data, error } = await auth.db.rpc('dd_worker_totp', { p_token: auth.key, p_label: account });
    if (error) return fromDbError(error);
    return NextResponse.json(data);
  } catch {
    return apiError(500, 'server_error', 'Something went wrong.');
  }
}
