# v0.15.0 card details for payment verification

Applied as migration `dicedrop_v0_15_0_card_details`.

- Card details per buyer account, kept in the vault (`dicedrop_card_<account id>`): `dd_ops_set_card_details`, `dd_ops_clear_card_details`, `dd_ops_card_status`. The console can save or remove them, never read them.
- `dd_worker_card(box token, label)`: a box fetches its own account's card only when Amazon shows "Verify payment". Each fetch is logged in `box_events`.
- Worker 0.15.0: answers the verify-payment page (card number, expiry, security code), then confirms the order.
- Cancelled orders now read simply "Cancelled by Amazon".
