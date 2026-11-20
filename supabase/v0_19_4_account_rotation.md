# v0.19.4 account rotation (database only)
- `dd_dispatch_order` now spreads orders across accounts: an account must be under its daily limit; among free accounts the one with the fewest orders placed today goes first, then the one idle longest. Still one order per account at a time.
