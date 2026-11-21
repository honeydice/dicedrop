# v0.29.4

Amazon's "I am human" box met while looking at an order is reported as its own error, "Human check" (not "Verify Account"),
and the worker keeps that browser open live (NEEDS YOU on the account) so it can be ticked; the order is then looked at again.
Migration v0_29_6_human_check adds the reason to dd_worker_tracking_report and dd_worker_heartbeat.
