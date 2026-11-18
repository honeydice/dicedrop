# DiceDrop v0.1.1

The DiceDrop Control Tower: a live order board, an admin back room, and the API that connected apps use to send orders.

This release is the dash and database. The Worker (which places orders on Amazon) and the Monitor arrive in later versions and plug into the same database.

## What is in this version

- **Order board** (`/`): live status tabs (Pending, Ordering, Ordered, Shipped, Delivered, Issues), search, the spend strip (Spent today, Pending estimate, Projected today), and backup controls (Retry, Hold, Cancel) on each row.
- **Admin** (`/admin`): API keys, the connect snippet, buyer accounts, boxes, and selectors.
- **API** (`/api/v1`): send, look up, cancel, hold, and retry orders with one API key.
- **Workspaces**: every order, account, and key belongs to a workspace, and each workspace only sees its own data.

## Setup (about 10 minutes)

1. **Create a Supabase project** named DiceDrop, separate from DiceOps.
2. **Run the schema.** Open the SQL editor, paste all of `supabase/schema.sql`, and run it.
3. **Create a GitHub repo** named `dicedrop` and upload this folder.
4. **Deploy on Vercel.** Import the repo and add two environment variables (values are in Supabase under Project Settings > API):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`

   No privileged database key is needed. API keys are verified inside the database by the `dd_api_*` functions.
5. **Open the site**, choose "Create an account", then name your workspace.
6. **Optional:** run `supabase/sample_orders.sql` to drop a few sample orders onto the board.
7. **Create an API key** in Admin. Copy it right away; it is shown once.

## API

All requests use `Authorization: Bearer <your key>`.

| Call | What it does |
|---|---|
| `POST /api/v1/orders` | Send an order |
| `GET /api/v1/orders?order_number=...` | Look up orders |
| `GET /api/v1/orders/{id}` | One order with its event history |
| `POST /api/v1/orders/{id}/cancel` | Cancel (or request a cancel if already placed) |
| `POST /api/v1/orders/{id}/hold` | Hold a pending or flagged order |
| `POST /api/v1/orders/{id}/retry` | Send a flagged, held, or cancelled order back to pending |
| `GET /api/health` | Version and connection check |

Required fields when sending an order: `order_number`, `asin` (or `buy_url`), and `ship_to` with `name`, `line1`, `city`, `state`, `postal_code`.

Sending the same `order_number` (and `line_id`) twice returns the original order with `"duplicate": true`, so an order is never created twice.

### Test it

```bash
curl -X POST https://YOUR-DOMAIN/api/v1/orders \
  -H "Authorization: Bearer dd_live_..." \
  -H "Content-Type: application/json" \
  -d '{
    "order_number": "TEST-0001",
    "title": "Test item",
    "asin": "B000000000",
    "sale_price": 29.99,
    "sale_fees": 3.90,
    "est_cost": 18.00,
    "buyer": { "name": "Test Buyer", "username": "test_buyer" },
    "ship_to": { "name": "Test Buyer", "line1": "100 Example St", "city": "Austin", "state": "TX", "postal_code": "73301" }
  }'
```

The order appears on the board within a second.

## Notes

- **Spend strip:** "Spent today" totals the Amazon cost of orders placed since midnight in the workspace time zone (default `America/Chicago`; change it in the `workspaces` table).
- **Tax estimate:** uses base state rates from the `state_tax_rates` table. Edit any row to tighten it.
- **Who did what:** every action on an order is stamped in `order_events` with the actor and time.
- **Webhooks:** each key stores a webhook URL and signing secret now; DiceDrop starts sending status updates when the Worker ships.
