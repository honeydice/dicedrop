# v0.26.0 Simpler account controls, ordering switch, remove account
- `buyer_accounts.ordering_enabled` + `dd_ops_set_ordering`: off = the account is still checked for shipping but gets no new orders (`dd_dispatch_order`: dd_ordering_switch).
- `dd_ops_delete_account`: removes an account with its vault secrets, logs and screenshots; its orders stay.
- Accounts page: one Ordering switch and one Actions menu per account; details in two panels (setup, activity).
