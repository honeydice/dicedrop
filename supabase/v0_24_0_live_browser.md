# v0.24.0 Live browser (an account's VPS browser, used by hand)
- `buyer_accounts.browser_state / browser_url / browser_note / browser_requested_at / browser_seen_at`.
- `dd_ops_browser(account, open)`, `dd_worker_browser` (box reports opening / open + address / closed, learns when to close).
- Heartbeat hands out `browser_jobs` and clears a live browser the box stopped reporting on. `dd_dispatch_order`: an account in use by hand gets no orders.
- Worker: opens the Kameleo profile, serves a live view (picture + clicks/keys) on the box, reached through an encrypted cloudflared quick tunnel at a one-time address.
