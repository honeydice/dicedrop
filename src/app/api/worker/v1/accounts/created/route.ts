import { NextResponse } from 'next/server';
import { apiError, authenticate, fromDbError } from '@/lib/apiAuth';

export const dynamic = 'force-dynamic';

/**
 * POST /api/worker/v1/accounts/created   { "account": "AA029", "profile_name": "AA029", "profile_id": "...", "error": "" }
 * A box reports that it created (or failed to create) the Multilogin profile for a queued warm-up browser.
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

    const { data, error } = await auth.db.rpc('dd_worker_profile_created', {
      p_token: auth.key,
      p_label: account,
      p_profile_name: typeof body.profile_name === 'string' ? body.profile_name.slice(0, 200) : null,
      p_profile_id: typeof body.profile_id === 'string' ? body.profile_id.slice(0, 100) : null,
      p_error: typeof body.error === 'string' ? body.error.slice(0, 400) : null,
    });
    if (error) return fromDbError(error);
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return apiError(500, 'server_error', 'Something went wrong.');
  }
}
