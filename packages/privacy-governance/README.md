# Privacy Governance

`@sales-automation/privacy-governance` is the machine-readable source of truth for extension permissions, host boundaries, diagnostics access and Acquisition-state retention.

It records the exact least-privilege permissions used by the LinkedIn/Sales Navigator and Upwork extensions, prohibits cookie/private-message capture and remote code, assigns redacted diagnostic access by Prospect Desk scope, and returns non-executable retention/deletion plans.

Deletion plans can never target the full `%LOCALAPPDATA%\Codistan\Acquisition` root, unresolved synchronization state, reconciliation history, release evidence or rollback state. A separate human approval and operator action are always required.
