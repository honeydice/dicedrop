# v0.30.9 (console)

Orders page: a "hide" button on each order removes it from the main queue (and the per-status counts) without
deleting it. A "show hidden (N)" toggle reveals hidden orders, where each has an "unhide" button.
- orders.hidden_at column; dd_ops_hide_order(order, hide) operator RPC (logs hidden/unhidden).
- dd_ops_orders returns hidden_at; the console filters hidden out of the queue unless the toggle is on.
