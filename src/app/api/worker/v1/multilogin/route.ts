import { NextResponse } from 'next/server';
import { apiError, authenticate, fromDbError } from '@/lib/apiAuth';

export const dynamic = 'force-dynamic';

/**
 * POST /api/worker/v1/multilogin
 * A box reads the Multilogin sign-in it needs to open Multilogin profiles, with "Authorization: Bearer ddbox_...".
 */
export async function POST(req: Request) {
  try {
    const auth = authenticate(req);
    if (!auth.ok) return auth.response;
    const { data, error } = await auth.db.rpc('dd_worker_multilogin', { p_token: auth.key });
    if (error) return fromDbError(error);
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return apiError(500, 'server_error', 'Something went wrong.');
  }
}
