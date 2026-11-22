# v0.30.6

Orders expand now shows a "last session" trail: the plain-English steps of the last check/recheck and what it saw,
e.g. "opening AA008's browser / going straight to the order / signed in / read the order: ordered · screenshot saved",
or "... / saw Amazon's 'I am human' box · handed to you".
- Worker: step() keeps a trail per order (reset at session start); an outcome line is added after each order is read.
- Server: dd_worker_tracking_report stores metadata.session_trail (last 15 lines); dd_ops_orders returns it.
- Console: the trail renders under the detail grid in the order's expand.
Checks and rechecks populate it; place-order sessions are not trailed yet.
