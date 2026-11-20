# v0.19.0 automatic ordering
- API: `auto_order: true` (+ `delay_seconds`, default 60) on `POST /api/v1/orders`. The order is bought without an operator click once the delay has passed; `POST /orders/{id}/cancel` inside the window stops it.
- Sending the same order again with `auto_order` after an issue / cancel / hold re-queues that same order (same DD number). Never when it already has an Amazon order number or is in flight.
- Per client switch `workspaces.auto_order` (Clients tab: Auto-order on/off). On for CD E-Commerce Group.
- `dd_dispatch_order` is the single hand-off to a box; `dd_auto_dispatch` runs every 10 seconds (pg_cron `dicedrop-auto-order`). One order per account at a time; an order waits when no account is free.
- Clients tab: **New key value** makes a fresh API key for an existing entry (webhook + signing secret unchanged).
