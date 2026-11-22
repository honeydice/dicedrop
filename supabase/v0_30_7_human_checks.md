# v0.30.7

Order checks now behave like a person instead of a bot teleporting to a deep link:
- Human pace (1.5-2.1x) applied to checks, same as place-order runs.
- Sign-in goes amazon.com -> Your Orders (no straight deep-link start_url).
- open_order walks Your Orders and clicks into the order (mouse moves to the element); look_around adds
  mouse movement + scrolling on Your Orders and before opening each order.
- The order-details deep link is only used when a verify notice is expected (right after placing). Routine
  checks never deep-link; the bank-verify notice is still caught from the order page once it is open.
Trade-off: checks are slower and use a little more proxy data, but look far less automated (reduces human checks).
