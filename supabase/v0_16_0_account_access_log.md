# v0.16.0 account access log
- Table `account_access_log`; `dd_worker_account_access` (box writes one line per browser session), `dd_ops_account_log` (last 20 for the console).
- Worker 0.16.0 reports reason, result, outgoing IP and duration after every session: sign-in, order check, cart-only run, place order.
- Accounts page: Logs button in the expanded account.
