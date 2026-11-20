# v0.23.0 Orders bought by hand, activity log, warm-up at all hours
- `dd_api_link_order` + `manual_order` on POST /api/v1/orders: attach an Amazon order number and account to an order; DiceDrop follows it (never buys).
- `dd_api_accounts` + GET /api/v1/accounts (labels only).
- `dd_ops_access_log_all`: one activity list across accounts (Accounts page).
- Warm-up sessions run at all hours (heartbeat marker dd_warmup_all_hours).
