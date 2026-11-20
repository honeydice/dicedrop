# v0.23.1 Amazon account hold ("Verify your account")
- Worker reads "Order on hold / Verify your account / unusual account activity" on Your Orders and reports the order as the error "Verify Account" with the screenshot and Amazon's words.
- `buyer_accounts.hold_reason / hold_at`; set and cleared by order checks (`dd_account_hold` in dd_worker_tracking_report), cleared by hand with `dd_ops_clear_hold`.
- `dd_dispatch_order` (dd_hold): an account on hold gets no orders. Heartbeat keeps Verify Account orders on the check list.
