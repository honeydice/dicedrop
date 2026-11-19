# v0.17.0 DiceDrop order numbers, pulses, public docs
- `orders.dd_number` (DD-100001…): DiceDrop's own order number, on every order, API reply and pulse.
- `webhook_deliveries` + triggers: order.ordered / shipped / tracking_updated / delivered / issue / cancelled, and order.proof for each milestone screenshot.
- `dd_webhook_dispatch()` runs every 10 seconds (pg_cron `dicedrop-webhooks`): signed POST (`DiceDrop-Signature: t=…,v1=HMAC-SHA256("t.body")`), 8 tries over about a day, 30-day log.
- Operator tools: `dd_ops_webhook_log`, `dd_ops_set_key_webhook`, `dd_ops_test_pulse`, `dd_ops_resend_pulse`. Clients tab: Pulses log, webhook URL per key, Send test pulse, resend.
- API: `GET /api/v1/orders/DD-100042` works; replies carry `dicedrop_order_id`, `fulfilled_by`, shipment and proofs. `POST /api/v1/ping` is a stand-in receiver.
- Public docs at `/docs`.
