# v0.16.1 shipped details
- Checker opens Track package from the order's own page when the order is past the first page of Your Orders (20-40 watched orders).
- `dd_api_get_order` adds `shipment` (status, carrier, tracking_number, delivery_window, shipped_at, delivered_at) and `proofs` (kind, note, taken_at, image).
- Orders row shows carrier + tracking + expected date once shipped; carrier in the details.
