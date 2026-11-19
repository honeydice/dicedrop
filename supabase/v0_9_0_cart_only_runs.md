# v0.9.0 cart-only runs

Applied as migration `dicedrop_v0_9_0_cart_only_runs`.

- `orders`: run_requested_at, run_kind, run_note. `order_snapshots`: latest worker screenshot per order.
- `dd_ops_create_test_order`, `dd_ops_order_now` (cart only), `dd_ops_order_snapshot`.
- `dd_worker_order_details`, `dd_worker_order_progress`; heartbeat lists `order_jobs`.
- Worker 0.9.0: cart-only run (clear cart, add item, add buyer address as default, open checkout, read totals, screenshot). It has no place-order step.
