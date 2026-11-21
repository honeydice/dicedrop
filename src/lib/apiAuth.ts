import { NextResponse } from 'next/server';
import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js';
import { hasSupabaseEnv, SUPABASE_ANON_KEY, SUPABASE_URL } from '@/lib/env';

export function apiError(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export type ApiAuth =
  | { ok: true; db: SupabaseClient; key: string }
  | { ok: false; response: NextResponse };

/**
 * Reads the "Authorization: Bearer dd_live_..." header.
 * The key itself is verified inside the database by the dd_api_* functions,
 * so this app never holds a privileged database key.
 */
export function authenticate(req: Request): ApiAuth {
  if (!hasSupabaseEnv()) {
    return { ok: false, response: apiError(503, 'not_configured', 'DiceDrop is not connected to its database yet.') };
  }

  const header = req.headers.get('authorization') ?? '';
  const key = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  if (!key) {
    return { ok: false, response: apiError(401, 'missing_key', 'Send your API key as: Authorization: Bearer <key>') };
  }

  const db = createSupabaseClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return { ok: true, db, key };
}

/** Turns a database error from a dd_api_* function into the right API response. */
export function fromDbError(error: { code?: string; message?: string }) {
  const message = error.message || 'Something went wrong.';
  switch (error.code) {
    case 'DD401':
      return apiError(401, 'invalid_key', message);
    case 'DD403':
      return apiError(403, 'workspace_paused', message);
    case 'DD404':
      return apiError(404, 'not_found', message);
    case 'DD422':
      return apiError(422, 'missing_fields', message);
    case 'P0001':
      return apiError(409, 'not_allowed', message);
    case '22P02':
    case '22007':
    case '22008':
      return apiError(422, 'invalid_value', 'One of the values is not in the expected format.');
    default:
      return apiError(500, 'server_error', 'Something went wrong on our side. Nothing was changed.');
  }
}

/** The one sentence a client is shown for any error. What went wrong stays with the operator. */
export const CLIENT_ISSUE = 'Could not order this item - try again';

/**
 * What a client is told an order's status is (the same rule as dd_client_status in the database):
 * placed but not yet seen on Amazon is still "ordering"; a human check or payment check changes nothing for the client.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function clientStatus(o: any): string {
  if (o.status === 'issue' && (o.issue_reason === 'Human check' || o.issue_reason === 'Verify Payment')) {
    return !o.confirmed_at ? 'ordering' : o.shipped_at ? 'shipped' : 'ordered';
  }
  if (o.status === 'ordered' && !o.confirmed_at) return 'ordering';
  return o.status;
}

/** The order fields the public API returns. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function publicOrder(o: any) {
  const status = clientStatus(o);
  const bought = status === 'ordered' || status === 'shipped' || status === 'delivered';
  return {
    dicedrop_order_id: o.dd_number,
    fulfilled_by: 'DiceDrop',
    id: o.id,
    status,
    cancel_requested: o.cancel_requested,
    auto_order_at: o.auto_order_at ?? null,
    source: o.source,
    order_number: o.order_number,
    line_id: o.line_id,
    store_code: o.store_code,
    title: o.title,
    asin: o.asin,
    buy_url: o.buy_url,
    quantity: o.quantity,
    sale_price: o.sale_price,
    sale_fees: o.sale_fees,
    est_cost: o.est_cost,
    buy_cost: o.buy_cost,
    buy_tax: o.buy_tax,
    buy_shipping: o.buy_shipping ?? null,
    delivery_window: o.metadata?.checkout?.delivery_estimate ?? null,
    profit: o.profit,
    amazon_order_id: bought ? o.amazon_order_id : null,
    tracking_number: o.tracking_number,
    carrier: o.carrier,
    issue_reason: status === 'issue' ? CLIENT_ISSUE : null,
    created_at: o.created_at,
    updated_at: o.updated_at,
    placed_at: bought ? o.placed_at : null,
    shipped_at: o.shipped_at,
    delivered_at: o.delivered_at,
  };
}
