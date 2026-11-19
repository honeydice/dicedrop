# v0.11.0 gift settings

Applied as migration `dicedrop_v0_11_0_gift_settings`.

- `platform_settings`: gift_enabled, gift_from, gift_message.
- `dd_worker_order_details` returns the gift settings.
- Worker 0.11.0: after the address, opens "Add gift options", writes the message and sender, saves, then takes a full-page screenshot.

v0.11.1 (`dicedrop_v0_11_1_gift_per_order`): gift moved onto each order (`orders.gift`, `gift_from`, `gift_message`), sent with the order through the API. The global gift setting is no longer used.
