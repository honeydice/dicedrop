# v0.5.0 account details

Applied to the DiceDrop Supabase project as migrations `dicedrop_v0_5_0_account_details` and `dicedrop_v0_5_0_account_access`.

- `cards` table: the card library (bank + last 4 + nickname only).
- `buyer_accounts`: supplier, region, billing name / zip / phone, card_id, max_pending_orders, auto_tracking, order_scan, password_set, visibility (public / private), allowed_clients.
- `dd_ops_save_account(p_id, p)`: create or update an account from the Add account form. Password and two-step key go to the vault.
- `dd_ops_accounts()`: returns the new fields plus the card library.
- `dd_worker_claim`: respects max pending orders, the daily price limit, and public / private access.
- `dd_worker_tracking`: skips accounts with auto tracking off.

Nothing signs in to Amazon yet; the saved password is not exposed to any worker function.
