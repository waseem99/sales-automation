# Codistan LinkedIn Opportunity Capture V4

## Operator modes

### Capture visible requirements

Captures supported buyer-intent posts currently visible on a user-opened LinkedIn content search, feed, or individual post page.

### Scan and load more results

Available on LinkedIn content-search pages only. This user-triggered bounded scan:

- inspects the current visible result window;
- scrolls up to four times;
- waits 2.5 seconds between steps so LinkedIn can lazy-load more cards;
- resolves timestamp and activity links spatially to the correct card;
- merges up to 30 unique canonical opportunities;
- submits the batch once;
- restores the original scroll position.

It does not click LinkedIn controls, change searches, paginate, open tabs, message, connect, follow, react, comment, email, or bypass security controls. External actions remain manual.
