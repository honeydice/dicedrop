# v0.27.0 "Needs you" hand-over
- When Amazon shows its "I am human" page after Place your order, the worker keeps the browser open, opens the live view on that same page
  and marks the account "NEEDS YOU" (dd_worker_browser state `needs_you`). It waits up to 20 minutes, then carries on by itself:
  order number, Ordered, screenshot, tracking.
- The worker never ticks the box itself.
- v0.26.1: a Multilogin profile open on another computer makes the worker wait (order back to pending, retried) instead of an error.
