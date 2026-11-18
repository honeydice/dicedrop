# v0.6.0 proxy library

Applied as migration `dicedrop_v0_6_0_proxy_library`.

- `proxies` table (provider, label, host, port, username). Passwords live in the vault as `dicedrop_proxy_<id>`.
- `buyer_accounts.proxy_id`: one dedicated proxy per account (unique).
- `dd_ops_import_proxies(text, provider)`: bulk import of `host:port:username:password` lines.
- `dd_ops_proxies()`, `dd_ops_set_account_proxy(account, proxy)`, `dd_ops_remove_proxies(ids)`.
