# v0.30.1

Recheck shows live steps under the button (asked, VPS picked it up, browser open, signed in, done with the result).
The worker posts {"step": ...} to the order check route; dd_ops_recheck_status reads it. Migration v0_30_1_recheck_status.
