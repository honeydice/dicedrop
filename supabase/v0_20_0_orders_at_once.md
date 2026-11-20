# v0.20.0 several orders at once per box
- Worker 0.20.0 runs several jobs side by side (orders, order checks, sign-ins), each on its own account and browser. An account is only ever open once; an order run is only ever started once (run token).
- `platform_settings.orders_at_once` (default 2, Settings -> vps capacity). Dispatch hands a box up to that many orders at a time; the heartbeat tells the box the number (`max_jobs`).
- Heartbeat: an order whose checkout showed Amazon's verify-payment page is looked at every 3 minutes for 25 minutes.
