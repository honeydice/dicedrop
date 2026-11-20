import { NextResponse } from 'next/server';
import { apiError, authenticate, fromDbError, publicOrder } from '@/lib/apiAuth';

export const dynamic = 'force-dynamic';

function str(v: unknown): string | null {
  if (typeof v === 'string' && v.trim() !== '') return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function asinFromUrl(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
  return m ? m[1].toUpperCase() : null;
}

/**
 * POST /api/v1/orders
 * Send an order to DiceDrop. Sending the same order_number (+ line_id) twice returns the
 * original order instead of creating a second one.
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

    const shipTo = (body.ship_to ?? {}) as Record<string, unknown>;
    const buyer = (body.buyer ?? {}) as Record<string, unknown>;

    const orderNumber = str(body.order_number);
    const buyUrl = str(body.buy_url);
    const asin = (str(body.asin) ?? asinFromUrl(buyUrl))?.toUpperCase() ?? null;
    const shipName = str(shipTo.name);
    const line1 = str(shipTo.line1);
    const city = str(shipTo.city);
    const state = str(shipTo.state);
    const postal = str(shipTo.postal_code);

    const missing: string[] = [];
    if (!orderNumber) missing.push('order_number');
    if (!asin && !buyUrl) missing.push('asin (or buy_url)');
    if (!shipName) missing.push('ship_to.name');
    if (!line1) missing.push('ship_to.line1');
    if (!city) missing.push('ship_to.city');
    if (!state) missing.push('ship_to.state');
    if (!postal) missing.push('ship_to.postal_code');
    if (missing.length > 0) {
      return apiError(422, 'missing_fields', `Missing: ${missing.join(', ')}`);
    }

    const quantity = body.quantity === undefined ? 1 : Math.floor(Number(body.quantity));
    if (!Number.isFinite(quantity) || quantity < 1) {
      return apiError(422, 'invalid_quantity', 'quantity must be 1 or more.');
    }

    const metadata =
      body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata) ? body.metadata : {};

    // Gift is per order: { "gift": { "message": "...", "from": "..." } }, or the flat gift / gift_message / gift_from fields.
    const giftBox = body.gift && typeof body.gift === 'object' && !Array.isArray(body.gift) ? (body.gift as Record<string, unknown>) : null;
    const giftMessage = str(giftBox ? giftBox.message : body.gift_message);
    const giftFrom = str(giftBox ? giftBox.from : body.gift_from);
    const giftOn = giftBox ? giftBox.enabled !== false && Boolean(giftMessage) : body.gift === true || body.gift === 'true' || body.gift === 'yes';

    const order = {
      source: str(body.source) ?? 'ebay',
      order_number: orderNumber,
      line_id: str(body.line_id),
      store_code: str(body.store_code),
      title: str(body.title),
      photo_url: str(body.photo_url),
      asin,
      buy_url: buyUrl,
      quantity,
      buyer_name: str(buyer.name) ?? shipName,
      buyer_username: str(buyer.username),
      ship_name: shipName,
      ship_line1: line1,
      ship_line2: str(shipTo.line2),
      ship_city: city,
      ship_state: state,
      ship_postal: postal,
      ship_country: str(shipTo.country) ?? 'US',
      ship_phone: str(shipTo.phone),
      ship_by: str(body.ship_by),
      sale_price: num(body.sale_price),
      sale_fees: num(body.sale_fees),
      est_cost: num(body.est_cost),
      metadata,
      gift: giftOn ? 'true' : 'false',
      gift_message: giftMessage,
      gift_from: giftFrom,
      // auto_order: buy it without an operator click, after delay_seconds (default 60) in which it can still be cancelled.
      auto_order: body.auto_order === true || body.auto_order === 'true' ? 'true' : 'false',
      delay_seconds: num(body.delay_seconds),
    };

    const { data, error } = await auth.db.rpc('dd_api_create_order', { p_key: auth.key, p_order: order });
    if (error) return fromDbError(error);

    const duplicate = Boolean(data?.duplicate);
    return NextResponse.json({ order: publicOrder(data.order), duplicate, requeued: Boolean(data?.requeued) }, { status: duplicate ? 200 : 201 });
  } catch {
    return apiError(500, 'server_error', 'Something went wrong. Nothing was placed.');
  }
}

/**
 * GET /api/v1/orders?order_number=...&status=...&limit=50
 * Look up orders in your workspace.
 */
export async function GET(req: Request) {
  try {
    const auth = authenticate(req);
    if (!auth.ok) return auth.response;

    const params = new URL(req.url).searchParams;
    const limit = Math.min(200, Math.max(1, Number(params.get('limit') ?? 50) || 50));

    const { data, error } = await auth.db.rpc('dd_api_list_orders', {
      p_key: auth.key,
      p_order_number: params.get('order_number'),
      p_status: params.get('status'),
      p_limit: limit,
    });
    if (error) return fromDbError(error);

    const rows = Array.isArray(data) ? data : [];
    return NextResponse.json({ orders: rows.map(publicOrder) });
  } catch {
    return apiError(500, 'server_error', 'Something went wrong.');
  }
}
