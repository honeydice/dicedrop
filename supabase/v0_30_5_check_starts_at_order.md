# v0.30.5

Order checks skip amazon.com. A check now opens the first order's own page directly (via amazon_sign_in
start_url) instead of loading the amazon.com home + account pages first. If the Multilogin session is still
signed in that is the only load; if it has lapsed Amazon sends it to the sign-in screen and the normal login
walk runs. Faster and less proxy data. Place-order, sign-in and warm-up jobs are unchanged (default path).
