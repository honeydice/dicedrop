# v0.17.2 ordered proof always saved
- Worker 0.17.2: a brand-new order often has no Track package button yet; the worker now uses the order's own page, always takes a screenshot, reads the delivery window (also from the confirmation page), and saves both as the order's `ordered` proof right away.
- The passing 'verify payment' address on the way to the confirmation page is no longer reported as a verification.
- Every step after ordering is written to the log.
