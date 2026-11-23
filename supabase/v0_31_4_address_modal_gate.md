# v0.31.4

Real fix for the address-suggestion failure: the "Verify your address" dialog handler was gated behind
`if form_open():`, but form_open() only sees the address form's input fields. When the dialog appears those
fields are gone, so the handler never ran and a later click landed on the main checkout continue button behind
the dialog, hanging 30s (Playwright's default).
- The handler is now called by detecting the dialog itself (verify_address_dialog), retried briefly after submit.
- safe_click uses a 6s timeout and moves on, so no click can hang 30s (tested: bails in ~6s on a covered button).
- The final confirm click is skipped when delivery is already set, and no longer uses the broad
  "Deliver to this address" text selector that matched the page's continue button.
- The saved-address branch also handles the dialog now.
Tested: resolver (5 cases, generic radio names + background trap button) and safe_click timeout.
