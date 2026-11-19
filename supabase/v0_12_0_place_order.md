# v0.12.0 place order

Applied as migration `dicedrop_v0_12_0_place_order`.

- `dd_ops_order_now(order, kind)`: kind `cart_only` (default) or `place_order`. A placed or possibly-placed order is refused a second time.
- `dd_worker_order_progress`: a placed order becomes `ordered` with the Amazon order number, total, tax, shipping, and items.
- Worker 0.12.0: `place_order()` is the only code that buys; it clicks once and never retries.
