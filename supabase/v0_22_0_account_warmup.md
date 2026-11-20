# v0.22.0 Account warm-up (turned on per account)
- `buyer_accounts.warmup_until / warmup_days / warmup_next_at / warmup_last_at / warmup_sessions`.
- `dd_ops_set_warmup(account, days)` (0 = off), `dd_worker_warmup_done`; heartbeat hands out `warmup_jobs` (7am to 11pm, next session 4 to 7 hours after the last).
- `dd_dispatch_order`: an account that is warming up gets no orders.
