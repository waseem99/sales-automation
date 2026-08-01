# Seller queues

`@sales-automation/seller-queues` derives internal work queues from persisted prospect, follow-up, synchronization, identity, scoring, campaign and commercial-readiness state.

Queue membership is server-derived and deterministic. Queue, sort and filter preferences are integrity-protected and tied to the authenticated seller identity. URL parameters provide refresh-safe and shareable deep links.

The package does not perform proposals, LinkedIn actions, email or any other external sales action. Human review remains required.
