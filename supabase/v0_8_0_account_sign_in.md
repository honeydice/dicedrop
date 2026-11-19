# v0.8.0 account sign-in

Applied as migration `dicedrop_v0_8_0_account_sign_in`.

- `buyer_accounts`: kameleo_profile_id, signin_requested_at, signin_note, exit_ip.
- `account_snapshots`: the latest worker screenshot per account.
- `dd_ops_request_signin`, `dd_ops_account_snapshot` (operator).
- `dd_worker_account_secrets`, `dd_worker_account_update` (box, by box token; a box only reaches its own accounts).
- `dd_worker_heartbeat` now lists which accounts are waiting for a sign-in.
- Worker 0.8.0 (`public/dd/worker.py`): creates one Kameleo profile per account with its dedicated proxy, checks the proxy, signs in to Amazon, reports state + screenshot.
