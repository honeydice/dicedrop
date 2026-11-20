# v0.19.5 one order per box (database only)
- `dd_dispatch_order` hands an order over only when the account's box is free. Orders waiting for a box stay pending and go out as soon as one frees up, rotating accounts.
