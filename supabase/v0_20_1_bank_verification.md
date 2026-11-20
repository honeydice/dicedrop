# v0.20.1 bank verification at checkout
- When Amazon shows its verify-payment page during checkout and nothing can be filled in (a bank identity check), the order is reported as **Verify Payment** straight away, with a screenshot of that page, instead of Ordered.
- It stays Verify Payment until Amazon shows it shipped, or 45 minutes pass with the order still standing; a cancellation becomes Cancelled by Amazon.
- An Amazon sign-in page is never mistaken for the order page.
