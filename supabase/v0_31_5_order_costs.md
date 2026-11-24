# v0.31.5

A check now reads the order's own cost summary (Item(s) Subtotal / Shipping / Tax / Grand Total) off the order
details page via read_order_totals(), so a manual order gets its real COGS and tax instead of a placeholder.
dd_worker_tracking_report (migration v0_31_5_check_costs) fills buy_items/buy_shipping/buy_tax/buy_cost when the
total is read and, when the total changes, sends the refreshed costs to the client (DiceOps upserts cost_* on the pulse).
Tested: the parser reads items/shipping/tax/total and no longer mistakes "Total before tax" for tax.
