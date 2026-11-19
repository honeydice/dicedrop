# v0.18.0 Verify Payment
- Worker 0.18.0: every look at an order (right after ordering and every check) notices Amazon's "Your bank requires verification for the card" hold.
  It then does what a person does: order page -> Verify payment -> pick the card on file -> re-enter the card number saved on the account -> Verify card (two tries at most).
- If that does not clear it, the order becomes an issue: **Verify Payment**, with a screenshot, and stays in the regular checks so it returns to Ordered by itself once the payment is verified.
- `dd_worker_tracking_report` understands state `verify`; heartbeat keeps Verify Payment orders in the checks and sends `verify_attempts`.
- Weekday-only delivery dates ("Arriving Saturday") are read.
- A cart-only run is not offered on an order that already has an Amazon order number.
