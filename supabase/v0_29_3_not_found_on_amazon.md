# v0.29.3

An order the worker cannot find on Amazon (not in Your Orders, own page does not open) is no longer left at Ordered.
Right after placing it becomes the error "Not found on Amazon" at once; later, after two looks in a row. It keeps being checked and returns to Ordered when Amazon shows it again.
A person check met during an order look flags the account and the order (Verify Account).
Applied as migration v0_29_3_not_found_on_amazon (patches dd_worker_tracking_report, dd_worker_heartbeat).
