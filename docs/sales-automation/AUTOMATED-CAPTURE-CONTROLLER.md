# Automated Capture Controller

## Objective

Run bounded lead capture without requiring the operator to scroll source pages manually, while preserving the existing authenticated Chrome profile, local acquisition state, human commercial review and all platform safety boundaries.

## Runtime topology

| Component | Endpoint / cadence | Responsibility |
| --- | --- | --- |
| Upwork collector | `127.0.0.1:8765` | Validate, qualify, deduplicate and persist Upwork opportunities. |
| LinkedIn collector | `127.0.0.1:8775` | Validate, qualify, deduplicate and persist warm LinkedIn requirements. |
| Sales Navigator collector | `127.0.0.1:8785` | Persist cold campaign fit with no-confirmed-intent provenance. |
| Capture controller | `127.0.0.1:8795` | Coordinate non-overlapping source cycles, status and explicit local controls. |

The controller starts with the existing Windows supervisor. It binds its local status/control endpoint before launching the first capture cycle.

## Cycle order

A normal cycle is sequential:

1. Upwork approved saved searches.
2. Upwork top-five job-detail enrichment.
3. LinkedIn buyer-intent searches.
4. Sales Navigator only when its twelve-hour interval is due.
5. Rebuild the local Lead Desk.
6. Persist source counts, errors, last-cycle time and next-cycle time.

The next combined Upwork/LinkedIn cycle is scheduled fifteen minutes after the prior cycle finishes. This prevents overlapping browser scans.

## Browser governance

- Google Chrome uses the previously confirmed profile and normal account sessions.
- Source searches and detail pages open in inactive temporary tabs.
- Only one temporary source tab is processed at a time.
- Every temporary trigger/search/detail tab closes after completion or failure.
- The permanent governed workspace remains one Upwork tab, one LinkedIn tab and one Lead Desk tab.
- Unrelated Chrome windows and tabs are not changed.

## Upwork limits

- Three explicitly approved saved searches only.
- Up to four controlled scroll steps per search.
- Up to thirty visible cards per search.
- Up to five strongest candidates per cycle receive a detail-page pass.
- Detail evidence may include the visible full description, skills, budget/rate, payment status, client spend, hire rate, proposal count, location, age and canonical job URL when Upwork exposes them.
- Login, account-security, CAPTCHA or redirected pages fail that search safely.

## LinkedIn limits

- Five buyer-intent search definitions only.
- Up to four controlled scroll steps per search.
- Up to thirty visible public/professional posts per search.
- Login, checkpoint and authwall pages fail that search safely.
- Private messages and conversation content are never captured.

## Sales Navigator limits

- Registered licensed search URLs only.
- Twelve-hour cadence plus explicit Run Now.
- Results remain cold ICP fit and do not become confirmed buyer demand.
- No messaging or connection action is available to the controller.

## Lead Desk controls

The local Lead Desk displays:

- Current controller state.
- Last completed cycle.
- Next combined cycle.
- Next Sales Navigator cycle.
- Per-source new, duplicate, enriched and error summaries.
- **Run Capture Now**.
- **Pause Automated Capture** / **Resume Automated Capture**.

Control requests use a locally generated token stored under the protected acquisition state. The token is not sent to any external service.

## Service routing

Service routing uses weighted evidence rather than a first-match lane order:

1. Software/product development.
2. AI and automation.
3. Cybersecurity/GRC.
4. Digital growth.
5. Creative/animation.
6. Game/XR.
7. Delivery partnership.

Title evidence has the highest weight, followed by skills and body evidence. Ambiguous Priority A/B classification fails closed to Research until a human verifies the requested service.

## Non-negotiable safety boundaries

The controller and extensions never:

- Submit an Upwork proposal.
- Send a LinkedIn message or InMail.
- Send a connection or follow request.
- React to or comment on a post.
- Send email.
- Bypass login, verification, CAPTCHA or platform controls.
- Capture browser cookies, credentials or private-message bodies.
- Delete `%LOCALAPPDATA%\Codistan\Acquisition`.

Every external commercial action remains manual and human-approved.

## Operator lifecycle

- **Start Sales Automation** starts collectors, controller and governed workspace.
- **Run Capture Now** requests a non-overlapping local cycle.
- **Pause Automated Capture** prevents future cycles but does not destroy state.
- **Stop Sales Automation** stops collectors/controller and closes only Codistan-managed tabs.

## Validation requirements

Before this capability is treated as accepted on the operator machine:

1. Both unpacked extensions are reloaded at the exact expected versions.
2. Ports 8765, 8775, 8785 and 8795 report healthy local status.
3. One immediate real cycle completes in the authenticated Chrome profile.
4. Temporary tabs close themselves.
5. Lead Desk records per-source status and refreshes the queue.
6. The known fintech portal example routes to software/product development rather than creative animation.
7. Human review confirms that Priority A/B output is commercially useful.
