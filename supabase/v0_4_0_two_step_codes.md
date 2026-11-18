# v0.4.0: two-step codes

Applied as the Supabase migration `dicedrop_v0_4_0_two_step_codes` (full SQL in the project's migration history).

- `buyer_accounts.totp_enabled`, `totp_set_at`.
- Keys live in Supabase Vault as `dicedrop_totp_<account id>`.
- `dd_base32_decode`, `dd_totp_code` (RFC 6238, checked against the RFC test vectors), `dd_account_totp_code`.
- Operator: `dd_ops_set_totp`, `dd_ops_clear_totp`; `dd_ops_accounts` now returns each live code.
- Worker: `dd_worker_totp(token, label)` returns the code for an account on the calling box and logs the request in `box_events`.
