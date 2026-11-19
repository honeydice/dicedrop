# v0.17.4 the order itself, or no picture
- Worker 0.17.4: `open_order` gets the exact order on screen (Your Orders -> the order -> Track package / View order details), retries when it is not listed yet or Amazon answers "unable to load your order details", and only then takes the picture. After ordering it tries for about 3 minutes.
- Heartbeat: a just-placed order with no `ordered` picture is checked again every 3 minutes until it has one.
- An error page is never saved as proof.
