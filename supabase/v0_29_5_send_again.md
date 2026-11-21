# v0.29.4 / v0.29.5 (database only)

- v0_29_4_not_found_needs_proof: an order marked "Not found on Amazon" returns to Ordered only when the worker report carries a picture, a delivery window or tracking.
- v0_29_5_send_again_after_lost_order: dd_api_create_order re-queues an order that Amazon cancelled, that cannot be found on Amazon, or whose account was removed, even when it had an Amazon order number. The old number is kept in metadata.earlier_amazon_orders.
