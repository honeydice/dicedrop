# v0.31.0

Place-order: handle Amazon's "Verify your address" dialog (the variant that shows the buyer's address plus a
normalized suggestion, e.g. "Spring" -> "Springs"). The worker now selects an option (prefers the buyer's
original, falls back to the suggestion since it ships to the same place) and presses "Use this address",
instead of stalling and erroring with "Amazon did not accept the buyer's address".
