# v0.30.0 - what clients are told

Clients (API and pulses) no longer see what went wrong, and hear "ordered" only once the order has been seen on Amazon.

- orders.confirmed_at: set when an ordered/shipped/delivered picture arrives (or the order was placed by hand / is shipped).
- dd_client_status(order): placed-but-unconfirmed -> "ordering"; Human check and Verify Payment change nothing for the client;
  every other error -> "issue" with issue_reason "Could not order this item - try again".
- Pulses (dd_queue_order_event, dd_order_payload) and the API (publicOrder) use that view. Error pictures and internal events are not sent.
- Any order shown to the client as an error can be sent again (dd_api_create_order).
- Console: an order waiting on Amazon's "I am human" box shows the tag HELP instead of ISSUE.
Migrations: v0_30_0_client_view, v0_30_0_client_view_manual_flag.
