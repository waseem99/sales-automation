# Codebase Review — July 2026

## Review objective

Prepare the repository for a developer to continue the current production product without navigating abandoned implementation paths.

## Production-aligned findings

The following are the authoritative product capabilities and were retained:

- Vercel/Neon Prospect Desk.
- Scoped team accounts and database-side access filtering.
- Public prospect discovery and enrichment.
- PPRA/EPADS, CanadaBuys, UNGM and private/nonprofit tender discovery.
- Strict tender validation and false-positive regression tests.
- Scoring, service/profile routing, portfolio matching and drafting.
- Engagement qualification and inbound-reply guidance.
- Automatic owner assignment and recommended contact channel.
- SMTP/IMAP outreach engine with mandatory safety gates.
- Feedback, follow-up, activity, outcome and source-learning records.

## Redundancy removed

- Duplicate `api/index.ts` Vercel runtime.
- Retired `/lead-desk` and legacy opportunity/ingestion/dev rewrites.
- Old Local MVP dashboard renderer and tests.
- Alternate auth, access-control, API and dashboard packages.
- Local Gmail OAuth/worker and Slack-notification runtime.
- Superseded prospecting, enrichment and analytics packages.
- Standalone evaluation CLI.
- Obsolete Render/local-MVP/Gmail planning and setup documents.
- Duplicate environment template.

## Deliberately retained foundations

- `packages/parsers` and `packages/ingestion`: tested manual/authorized Upwork and LinkedIn/Sales Navigator normalization. These are not production routes yet and should be integrated into the Prospect Desk/Neon architecture under a focused backlog issue.
- Local JSON repository and HTTP server: useful for development and package tests; Neon remains production.
- Core scoring/routing/drafting/alert packages: still used through the evaluator.
- Starter fixtures: still used for initial prospect seeding and tests; production portfolio replacement is pending.

## Remaining technical debt

1. Portfolio proof should move from fixtures to an approved managed catalog.
2. Manual authorized source intake should be integrated into the current dashboard rather than reintroducing the retired Lead Desk.
3. Closeability ranking should be separated from generic relevance scoring and calibrated against real wins.
4. Source health and delivery observability should become first-class dashboard data.
5. GitHub Actions intermittently fails before checkout; runner/account reliability remains unresolved.
6. Large server-rendered page files can be split after functional priorities stabilize.
7. The compatibility stub in `apps/web/src/server.ts` can be removed once the final internal call site is refactored; no production route exposes it.

## Developer decision rules

- Extend the current architecture instead of creating parallel dashboards, auth stacks, persistence layers or workers.
- Every new public source needs trust checks and real false-positive regression examples.
- Every data mutation must respect account scope and persist through Neon helpers.
- Every external communication feature must preserve human approval and deliverability gates.
- Use open GitHub issues as the current roadmap; closed historical epics are not implementation instructions.
