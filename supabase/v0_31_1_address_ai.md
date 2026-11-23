# v0.31.1

The "Verify your address" dialog is now read by the AI: it compares the buyer's original with Amazon's
suggestion and picks the suggestion only for a cosmetic fix of the same place (spelling, St<->Street, casing).
Hard guard in the worker: a suggestion is accepted only when the 5-digit ZIP AND the street number both match;
anything else keeps the original, and a genuinely different address stops for a person.
New route /api/worker/v1/address-choice (AI decision, logged like assist).
