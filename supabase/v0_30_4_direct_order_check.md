# v0.30.4

Status checks (not place-order) open an order by its own URL (ORDER_DETAILS + number) instead of walking
Your Orders -> find card -> click. Same read, fewer page loads (less Multilogin proxy data).
open_order() gains direct=False (default unchanged); check_order_look passes direct=True.
Hold / Track package / details detection all run on the direct page; if it does not show the order,
it falls back to the existing Your Orders walk. If Amazon shows a bot check, the human hand-over is unchanged.
