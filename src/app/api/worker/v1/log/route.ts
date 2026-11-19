import { NextResponse } from 'next/server';
import { apiError, authenticate, fromDbError } from '@/lib/apiAuth';

export const dynamic = 'force-dynamic';

/**
 * POST /api/worker/v1/log   { "type": "started" | "job" | "crash", "text": "..." }
 * A box leaves a short note for the operator, with "Authorization: Bearer ddbox_...".
 */
export async function POST(req: Request) {
  try {
    const auth = authenticate(req);
    if (!auth.ok) return auth.response;
    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return apiError(400, 'invalid_json', 'The request body must be JSON.');
    }
    const { error } = await auth.db.rpc('dd_worker_log', {
      p_token: auth.key,
      p_type: typeof body.type === 'string' ? body.type : 'note',
      p_text: typeof body.text === 'string' ? body.text.slice(0, 4000) : '',
    });
    if (error) return fromDbError(error);
    return NextResponse.json({ ok: true });
  } catch {
    return apiError(500, 'server_error', 'Something went wrong.');
  }
}
