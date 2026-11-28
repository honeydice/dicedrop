# DiceDrop v0.43.0

DiceDrop is an order automation system. Clients send orders through an API, a pool of buyer accounts running on worker boxes places them, and one operator console shows the health of the whole thing.

Clients never sign in. Only operators use the console.

## The three parts

| Part | Status | What it is |
|---|---|---|
| **Operator console + database** | Live | This repo. The console, the client API, and the worker API. |
| **Worker** | Next | Runs on each VPS box and places orders. Talks to the worker API. |
| **Monitor** | Later | Watches prices and stock. |

## The console

| Page | What it answers |
|---|---|
| **Overview** (`/`) | Is the system healthy right now? Order flow, issues, boxes, accounts, and who is ordering. |
| **Orders** (`/orders`) | Every order from every client. Filter by client, status, or search. Click a row for details and retry, hold, cancel. |
| **Clients** (`/clients`) | Who sends orders. Add a client, create or switch off its API keys, pause or resume it. |
| **Accounts** (`/accounts`) | The buyer account library: health, daily load, box assignment, and optional "reserved for" a client. |
| **VPS** (`/vps`) | Every box: connection, what it is placing, what is next in line, its accounts, and run, pause, drain controls. |
| **Settings** (`/settings`) | Light or dark theme, the day boundary time zone, selectors, and the operator list. |

## Client API (`/api/v1`)

All requests use `Authorization: Bearer dd_live_...`.

| Call | What it does |
|---|---|
| `POST /api/v1/orders` | Send an order |
| `GET /api/v1/orders?order_number=...` | Look up orders |
| `GET /api/v1/orders/{id}` | One order with its event history |
| `POST /api/v1/orders/{id}/cancel` | Cancel (or request a cancel if already placed) |
| `POST /api/v1/orders/{id}/hold` | Hold a pending or flagged order |
| `POST /api/v1/orders/{id}/retry` | Send a flagged, held, or cancelled order back to pending |

Required when sending an order: `order_number`, `asin` (or `buy_url`), and `ship_to` with `name`, `line1`, `city`, `state`, `postal_code`.
Sending the same `order_number` (and `line_id`) twice returns the original order with `"duplicate": true`.

## Worker API (`/api/worker/v1`)

Each box has its own token, created on the VPS page. All requests use `Authorization: Bearer ddbox_...`.
Boxes only ever call out; nothing connects in to a box.

| Call | What it does |
|---|---|
| `POST /api/worker/v1/heartbeat` | Check in, report state and per-account sign-in status. Returns `desired_state` (`run`, `pause`, `drain`), the box's accounts, and the selectors. |
| `POST /api/worker/v1/claim` | Ask for the next order. Returns `{ order, account }` or `{ order: null, reason }`. |
| `POST /api/worker/v1/orders/{id}/report` | Report `placed`, `issue`, `release`, `shipped`, `delivered`, or `cancelled`. |
| `GET /api/worker/v1/tracking` | Orders this box placed that still need a shipping or delivery check. |
| `POST /api/worker/v1/totp` | Body `{ "account": "AMZ-01" }`. Returns the current two-step code for one of the box's own accounts. |

How an order is assigned: the oldest waiting order (earliest ship-by first) goes to a free account on the calling box that is active or warming, signed in, under its daily cap, and not already placing an order.

## Two-step codes

DiceDrop is the authenticator for the buyer accounts. Each account's Amazon two-step key is stored encrypted in the database vault.
Codes are standard time-based codes (RFC 6238: SHA-1, 30 seconds, 6 digits), computed inside the database.

- **Settings > two-step codes**: add, replace, or stop a key per account.
- **Accounts**: the live code shows next to each account and copies on click.
- **Worker**: a box can request the code for its own accounts. It receives the 6 digits, never the key.

## How it is secured

- **Operators only.** Console data comes from database functions that check the caller is in `platform_admins`. A signed-in non-operator gets nothing.
- **No privileged key in the app.** Client API keys and box tokens are stored as hashes and verified inside the database by the `dd_api_*` and `dd_worker_*` functions.
- **Every action is stamped.** `order_events` records who did what and when: `api:<key>`, `worker:<box>`, or `user:<email>`.

## Database

`supabase/schema.sql` is the full schema through v0.1.x. `supabase/v0_2_0_operator_console.sql` is the v0.2.0 change. Run them in that order on a fresh project.

Add an operator:

```sql
insert into public.platform_admins (user_id, email)
select id, email from auth.users where email = 'you@example.com';
```
