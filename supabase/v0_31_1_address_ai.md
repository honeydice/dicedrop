# v0.31.1

The "Verify your address" dialog is now read by the AI: it compares the buyer's original with Amazon's
suggestion and picks the suggestion only for a cosmetic fix of the same place (spelling, St<->Street, casing).
Hard guard in the worker: a suggestion is accepted only when the 5-digit ZIP AND the street number both match;
anything else keeps the original, and a genuinely different address stops for a person.
New route /api/worker/v1/address-choice (AI decision, logged like assist).

## v0.31.2
Tested against a stand-in of Amazon's "Verify your address" dialog (5 cases): a stray "Use this address"
button behind the dialog could be clicked instead of the modal's own (the 30s hang), and the two addresses
could run together in extraction. Fixed: addresses are read off each radio's own label; confirm_suggestion()
scopes the "Use this address" click to the box holding the suggestion radios. Guard verified: a different ZIP
or house number keeps the original even when the AI says suggested; "stop" hands to a person.
