# Codistan Sales Automation Extension Permission, Privacy and Retention Review

Version: `extension-privacy.v1`

## Reviewed extensions

- Codistan LinkedIn & Sales Navigator Capture `1.6.1`
- Codistan Upwork Opportunity Capture `1.1.1`

Both extensions use Manifest V3 and load only repository-bundled JavaScript. Remote scripts, remote module loading, `eval`, `new Function`, WebAssembly code loading and dynamically downloaded executable code are prohibited.

## Permission inventory

| Permission | LinkedIn / Sales Navigator | Upwork | Necessity |
|---|---:|---:|---|
| `tabs` | Required | Required | Opens only registered searches in inactive tabs, reads load/redirect state, sends messages to bundled content scripts and closes scheduled tabs. |
| `storage` | Required | Required | Stores approved campaign/search configuration, scheduler preference and bounded operational status. It does not store cookies, credentials or private messages. |
| `scripting` | Required | Required | Re-injects only packaged content scripts when an approved page does not yet have a receiver. |
| `alarms` | Required | Required | Runs bounded approved-search schedules without continuous polling. |
| `activeTab` | Removed | Removed | Redundant because explicit host permissions already scope content scripts and scheduled tabs. |

Explicitly prohibited permissions include `cookies`, `webRequest`, `webRequestBlocking`, `history`, `downloads`, `nativeMessaging`, clipboard permissions, `declarativeNetRequest` and `<all_urls>`.

## Host permissions

### LinkedIn and Sales Navigator

- `https://www.linkedin.com/*` — approved warm-demand pages and Sales Navigator compatibility.
- `https://sales.linkedin.com/*` — licensed Sales Navigator lead-search compatibility.
- `http://127.0.0.1:8775/*` — local warm-demand collector.
- `http://127.0.0.1:8785/*` — local Sales Navigator collector.

### Upwork

- `https://www.upwork.com/*` — approved saved-search and job-card capture.
- `http://127.0.0.1:8765/*` — local Upwork collector.

No public remote collection endpoint is granted in either manifest.

## Data collection boundary

The extensions may capture visible opportunity, job, company and professional profile evidence needed for approved prospecting campaigns. They must not capture:

- cookies or cookie headers;
- authorization/session/CSRF tokens;
- passwords or credentials;
- private-message or conversation content;
- hidden browser storage belonging to the platform;
- login, checkpoint, challenge or verification data.

The parsers fail closed when critical public evidence is missing. Login, checkpoint and challenge surfaces are not bypassed or manipulated.

## External-action boundary

The extensions do not submit proposals, send messages or InMails, create connection requests, follow, react, comment, send email or update an existing user tab into an action surface. Scheduled search tabs open inactive and are closed after bounded capture.

**Automatic external actions: disabled and prohibited.** All commercial actions remain human-controlled and may only be recorded after manual completion or a separately approved confirmation integration.

## Diagnostics access

- Admin and Waseem: full **redacted** diagnostic summaries and exports.
- Team lead: redacted summary limited to the team-visible scope.
- Seller: own-scope health summary without detailed diagnostic export.
- No role can view raw secrets or private messages because they are not collected.
- Deletion is never executed automatically through the privacy report endpoint.

## Retention rules

| Data class | Retention | Deletion rule |
|---|---:|---|
| Extension scheduler/capture status | 30 days | Explicit scoped cleanup only; preserve campaign definitions and records. |
| Redacted parser diagnostics | 30 days | Preserve while tied to a regression, security investigation or unresolved sync record. |
| Successfully reconciled outbox payload | 90 days after applied/duplicate/merged | May leave the active outbox after review; retain idempotency and reconciliation metadata. |
| Pending/retrying/dead-letter/conflicted outbox | Until resolved | Never automatically delete. Replay or resolve first. |
| Source evidence | Active lifetime plus 365 days after terminal status | Targeted approved deletion only; retain an audit tombstone and version pins. |
| Audit events and version pins | 730 days after terminal status | Preserve longer for legal/contractual hold, release evidence, rollback or unresolved reconciliation. |

## Deletion and state preservation

Deletion planning is target-specific and requires a global operator. It cannot target `%LOCALAPPDATA%\Codistan\Acquisition` itself, paths outside it, unresolved synchronization/reconciliation state, or rollback/release/audit state. Plans require separate human approval and retain audit tombstones. No installer, privacy process or retention rule destructively removes the Acquisition state root.

## Review evidence

Automated checks validate exact manifest permissions and hosts, packaged-only code, no cookie/private-message APIs, no remote code, parser redaction, access decisions, retention timing, protected paths, no automatic deletion and no automatic external commercial action.
