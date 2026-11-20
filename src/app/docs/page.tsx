import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'DiceDrop API',
  description: 'Send orders to DiceDrop and receive signed pulses back.',
};

const BASE = 'https://dicedrop.vercel.app';

const SEND = `curl -X POST ${BASE}/api/v1/orders \\
  -H "Authorization: Bearer $DICEDROP_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "order_number": "22-15411-33373",
    "store_code": "CA009",
    "title": "Watercolor Paint Brushes 12Pcs",
    "asin": "B0XXXXXXXX",
    "quantity": 1,
    "sale_price": 19.99,
    "est_cost": 11.50,
    "buyer": { "name": "Jane Buyer", "username": "jane_buyer" },
    "ship_to": {
      "name": "Jane Buyer", "line1": "100 Example St", "line2": "Apt 4",
      "city": "Austin", "state": "TX", "postal_code": "73301", "phone": "5125550100"
    },
    "gift": { "message": "Thank you!", "from": "Your Store" }
  }'`;

const REPLY = `{
  "order": {
    "dicedrop_order_id": "DD-100042",
    "fulfilled_by": "DiceDrop",
    "id": "84484b80-751e-4eca-8391-b1ad7c82714e",
    "status": "pending",
    "order_number": "22-15411-33373"
  },
  "duplicate": false
}`;

const PULSE = `{
  "id": "5d0f6c3e-...",
  "event": "order.ordered",
  "created_at": "2026-11-19T21:40:12Z",
  "fulfilled_by": "DiceDrop",
  "order": {
    "dicedrop_order_id": "DD-100042",
    "order_number": "22-15411-33373",
    "store_code": "CA009",
    "status": "ordered",
    "supplier": "amazon",
    "supplier_order_id": "112-7964162-4821005",
    "costs": { "items": 9.99, "shipping": 0, "tax": 1.02, "total": 11.01, "currency": "USD" },
    "carrier": null,
    "tracking_number": null,
    "delivery_window": "Arriving December 11 - December 21",
    "issue_reason": null,
    "placed_at": "2026-11-19T21:40:11Z"
  }
}`;

const NODE = `// app/api/dicedrop/webhook/route.ts  (Next.js)   env: DICEDROP_WEBHOOK_SECRET
import crypto from 'crypto';

export async function POST(req: Request) {
  const raw = await req.text();                                   // the exact body, before parsing
  const header = req.headers.get('dicedrop-signature') ?? '';     // "t=1795121140,v1=ab12..."
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')));
  const expected = crypto
    .createHmac('sha256', process.env.DICEDROP_WEBHOOK_SECRET!)
    .update(parts.t + '.' + raw)
    .digest('hex');

  const fresh = Math.abs(Date.now() / 1000 - Number(parts.t)) < 300;
  const match = parts.v1?.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(parts.v1), Buffer.from(expected));
  if (!fresh || !match) return new Response('bad signature', { status: 401 });

  const pulse = JSON.parse(raw);
  // pulse.id is unique per pulse: skip it if you have already handled it.
  switch (pulse.event) {
    case 'order.ordered':   /* save pulse.order.costs.total, show "Ordered through DiceDrop" */ break;
    case 'order.shipped':   /* save pulse.order.carrier + tracking_number */ break;
    case 'order.delivered': break;
    case 'order.issue':     /* pulse.order.issue_reason */ break;
    case 'order.proof':     /* pulse.proof.kind, pulse.proof.image_jpeg_base64 */ break;
  }
  return new Response('ok');                                      // any 2xx within 6 seconds
}`;

const PY = `# Flask   env: DICEDROP_WEBHOOK_SECRET
import hmac, hashlib, os, time, json
from flask import Flask, request

app = Flask(__name__)

@app.post("/dicedrop/webhook")
def dicedrop():
    raw = request.get_data()                                   # exact bytes
    parts = dict(p.split("=", 1) for p in request.headers.get("DiceDrop-Signature", "").split(","))
    expected = hmac.new(os.environ["DICEDROP_WEBHOOK_SECRET"].encode(),
                        parts.get("t", "").encode() + b"." + raw, hashlib.sha256).hexdigest()
    if abs(time.time() - int(parts.get("t", 0))) > 300 or not hmac.compare_digest(parts.get("v1", ""), expected):
        return "bad signature", 401
    pulse = json.loads(raw)
    # handle pulse["event"] / pulse["order"]
    return "ok"`;

function Code({ children }: { children: string }) {
  return <pre className="mt-3 overflow-x-auto rounded-xl border border-line bg-panel p-4 font-mono text-xs leading-relaxed text-soft">{children}</pre>;
}

function H({ id, children }: { id: string; children: string }) {
  return (
    <h2 id={id} className="mt-12 scroll-mt-6 border-b border-divider pb-2 font-mono text-lg text-fg">
      {children}
    </h2>
  );
}

function Table({ rows }: { rows: [string, string][] }) {
  return (
    <div className="mt-3 overflow-x-auto rounded-xl border border-line">
      <table className="w-full table-fixed text-left text-[13px]">
        <tbody>
          {rows.map(([a, b]) => (
            <tr key={a} className="border-b border-divider last:border-b-0">
              <td className="w-[36%] break-words px-4 py-2 align-top font-mono text-accent">{a}</td>
              <td className="px-4 py-2 text-soft">{b}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function DocsPage() {
  return (
    <main className="min-h-screen bg-ink text-fg">
      <div className="mx-auto max-w-[860px] px-4 py-12">
        <div className="font-mono text-xs uppercase tracking-widest text-muted">API v1</div>
        <h1 className="mt-2 text-3xl font-semibold">DiceDrop API</h1>
        <p className="mt-3 max-w-[640px] text-[15px] leading-relaxed text-soft">
          Send an order, DiceDrop buys it and ships it to your buyer, and a signed pulse comes back at every step. One key, one endpoint to send, one endpoint of yours to receive.
        </p>

        <nav className="mt-6 flex flex-wrap gap-x-5 gap-y-2 font-mono text-[13px] text-accent">
          <a href="#connect">connect</a>
          <a href="#send">send an order</a>
          <a href="#read">read an order</a>
          <a href="#pulses">pulses</a>
          <a href="#receiver">receiver code</a>
          <a href="#status">statuses</a>
        </nav>

        <H id="connect">1. Connect</H>
        <p className="mt-3 text-[14px] leading-relaxed text-soft">
          You get two values from DiceDrop: an <b className="text-fg">API key</b> (starts with <code className="font-mono">dd_live_</code>) and a <b className="text-fg">webhook signing secret</b> (starts with{' '}
          <code className="font-mono">whsec_</code>). Send the key on every request. Keep both on your server.
        </p>
        <Code>{`Authorization: Bearer dd_live_...\nBase URL:      ${BASE}`}</Code>

        <H id="send">2. Send an order</H>
        <Code>{SEND}</Code>
        <Table
          rows={[
            ['order_number', 'Required. Your own order number. Sending the same one twice returns the first order, never a second purchase.'],
            ['asin / buy_url', 'Required (one of them). The Amazon item to buy.'],
            ['ship_to', 'Required: name, line1, city, state, postal_code. Optional: line2, phone, country.'],
            ['quantity', 'Optional, default 1.'],
            ['line_id', 'Optional. Set it when one order has several items; each item is its own DiceDrop order.'],
            ['gift', 'Optional. { message, from } marks the order as a gift with that note.'],
            ['auto_order', 'Optional, true or false. When true (and switched on for your account) the order is bought automatically after delay_seconds (default 60). Cancel inside that window with POST /orders/{id}/cancel. Sending the same order again with auto_order after an issue or a cancel puts that same order back in the queue: one order, one DiceDrop number.'],
            ['store_code, title, photo_url, buyer, sale_price, sale_fees, est_cost, ship_by, metadata', 'Optional. Stored on the order and sent back to you.'],
          ]}
        />
        <p className="mt-4 text-[14px] text-soft">Reply (201, or 200 with <code className="font-mono">duplicate: true</code>):</p>
        <Code>{REPLY}</Code>
        <p className="mt-3 text-[14px] leading-relaxed text-soft">
          <code className="font-mono text-accent">dicedrop_order_id</code> is DiceDrop&apos;s own number for the order. Store it next to yours and show it as &quot;Ordered through DiceDrop · DD-100042&quot;. It is the number to quote for support.
        </p>

        <H id="read">3. Read or change an order</H>
        <Table
          rows={[
            ['GET /api/v1/orders/{id}', 'One order with its events, shipment (carrier, tracking number, delivery window) and proof screenshots. {id} is the id or the DiceDrop number (DD-100042).'],
            ['GET /api/v1/orders?order_number=...', 'Find orders by your own order number or by status.'],
            ['POST /api/v1/orders/{id}/cancel', 'Ask to cancel. Also /hold and /retry.'],
          ]}
        />

        <H id="pulses">4. Pulses</H>
        <p className="mt-3 text-[14px] leading-relaxed text-soft">
          Give DiceDrop one https URL. Every change is sent there as a POST within seconds. Answer with any 2xx inside 6 seconds. If your server is down, DiceDrop retries 8 times over about a day.
        </p>
        <Table
          rows={[
            ['order.ordered', 'Bought. Carries the supplier order number and the real costs: items, shipping, tax, total.'],
            ['order.shipped', 'Carrier, tracking number and delivery window.'],
            ['order.tracking_updated', 'Tracking number or carrier changed after shipping.'],
            ['order.delivered', 'Delivered.'],
            ['order.issue', 'Needs attention. issue_reason says why, for example "Cancelled by Amazon".'],
            ['order.cancelled', 'Cancelled before buying.'],
            ['order.proof', 'A screenshot of a milestone: proof.kind (ordered, shipped, delivered, cancelled) and proof.image_jpeg_base64.'],
            ['ping', 'A test pulse.'],
          ]}
        />
        <Code>{PULSE}</Code>
        <Table
          rows={[
            ['DiceDrop-Signature', 't=<unix seconds>,v1=<hex>. v1 is HMAC-SHA256 of "<t>.<raw body>" using your signing secret.'],
            ['DiceDrop-Event', 'The event name.'],
            ['DiceDrop-Delivery', 'The pulse id. The same id is used on retries, so you can ignore repeats.'],
          ]}
        />

        <H id="receiver">5. Receiver code</H>
        <p className="mt-3 text-[14px] text-soft">Copy one of these, set the secret, and you are connected.</p>
        <Code>{NODE}</Code>
        <Code>{PY}</Code>

        <H id="status">Statuses</H>
        <Table
          rows={[
            ['pending', 'Received, waiting to be bought.'],
            ['ordering', 'Being bought right now.'],
            ['ordered', 'Bought. Costs and supplier order number are set.'],
            ['shipped', 'On the way. Carrier and tracking are set.'],
            ['delivered', 'Delivered.'],
            ['issue', 'Needs attention; see issue_reason.'],
            ['held / cancelled', 'Paused or cancelled.'],
          ]}
        />

        <H id="errors">Errors</H>
        <Code>{`{ "error": { "code": "missing_fields", "message": "Missing: ship_to.city" } }\n\n401 invalid_key · 403 workspace_paused · 404 not_found · 409 not_allowed · 422 missing_fields`}</Code>

        <div className="mt-14 font-mono text-xs text-muted">DiceDrop · API v1</div>
      </div>
    </main>
  );
}
