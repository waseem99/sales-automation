# Synchronization Health

`@sales-automation/sync-health` provides redacted, versioned health snapshots for LinkedIn, Upwork and Sales Navigator capture, local processing, durable outbox and Prospect Desk ingestion.

Snapshots expose pending, retrying, dead-letter and conflicted records by idempotency key without copying raw source evidence, cookies, tokens, credentials or private-message content. Endpoint-version mismatch is explicit.

Replay is permission-controlled and idempotent. The server produces an audited plan only; an authorized local operator resets the same durable idempotency keys to pending. Conflicted seller-owned fields cannot be replayed until manually resolved. `%LOCALAPPDATA%\Codistan\Acquisition` remains in place.
