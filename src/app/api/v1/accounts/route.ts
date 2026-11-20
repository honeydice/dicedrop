import { NextResponse } from 'next/server';
import { apiError, authenticate, fromDbError } from '@/lib/apiAuth';

export const dynamic = 'force-dynamic';

/** GET /api/v1/accounts : the Amazon account labels this client may name when it links an order it bought by hand. */
export async function GET(req: Request) {
  try {
    const auth = authenticate(req);
    if (!auth.ok) return auth.response;
    const { data, error } = await auth.db.rpc('dd_api_accounts', { p_key: auth.key });
    if (error) return fromDbError(error);
    return NextResponse.json({ accounts: data ?? [] }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return apiError(500, 'server_error', 'Something went wrong.');
  }
}
