# v0.14.0 order checks

Applied as migration `dicedrop_v0_14_0_order_checks`.

- `platform_settings.tracking_interval_minutes` (default 30); `buyer_accounts.last_tracking_check_at`, `tracking_requested_at`.
- `order_proofs`: the proof library, one picture per milestone (shipped, delivered, cancelled).
- `dd_worker_heartbeat` lists `tracking_jobs`: accounts due for a look at their placed orders.
- `dd_worker_tracking_report`: shipped / delivered / cancelled by Amazon, tracking number, carrier, estimate, picture.
- `dd_worker_tracking_done`, `dd_ops_check_orders_now`, `dd_ops_order_proofs`.
- Worker 0.14.0: Your Orders -> the order -> Track package (or the order's details when cancelled) -> status + picture.
