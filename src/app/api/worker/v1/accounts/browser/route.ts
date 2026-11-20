import { NextResponse } from 'next/server';
import { apiError, authenticate, fromDbError } from '@/lib/apiAuth';

export const dynamic = 'force-dynamic';

/**
 * POST /api/worker/v1/accounts/browser   { "account": "AMZ-01", "state": "opening" | "open" | "closed", "url": "...", "note": "..." }
 * A box reports on an account's live browser (the one the operator uses by hand) and is told when to close it.
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
    const text = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : null);

    const { data, error } = await auth.db.rpc('dd_worker_browser', {
      p_token: auth.key,
      p_label: account,
      p: { state: text(body.state, 20), url: text(body.url, 400), note: text(body.note, 300) },
    });
    if (error) return fromDbError(error);
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return apiError(500, 'server_error', 'Something went wrong.');
  }
}
