# v0.22.1 Orders that vanish from the Amazon account
- Worker: when an order cannot be opened, it looks under Cancelled Orders and at the order's own page. Found cancelled -> cancelled now. Not in the account at all -> reports `missing`.
- `dd_worker_tracking_report` (dd_missing): three `missing` checks in a row, at least 30 minutes after placing, turn the order into the "Cancelled by Amazon" error (pulse sent).
- Console: all text can be highlighted and copied, including inside rows and buttons.
