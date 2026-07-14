# Developer Handoff

## Start here

Read in this order:

1. `README.md`
2. `docs/ARCHITECTURE.md`
3. `docs/VERCEL_DEPLOYMENT.md`
4. `.env.example`
5. Current open GitHub issues

The production branch is `main`. The canonical application is the Prospect Desk at `/prospects`; do not revive the retired `/lead-desk` implementation.

## Local setup

Requirements:

- Node.js 22
- pnpm 9.15.9

```bash
pnpm install --no-frozen-lockfile
cp .env.example .env.local
pnpm dev
```

Open:

```text
http://localhost:3000
```

The local server uses the repository abstraction and local JSON files under `.data/`. Production uses Neon through the Vercel runtime.

## Required checks

Before opening a pull request:

```bash
pnpm typecheck
pnpm test
pnpm build
```

For deployment-sensitive work also run:

```bash
pnpm deploy:check
```

The production Vercel build executes four runtime smoke suites covering:

- Runtime and outreach policy.
- Dashboard access, pagination, assignment and engagement guidance.
- Login lockout recovery.
- Tender source validation and routing.

GitHub Actions has intermittently failed before executing runner steps. Treat an empty job with no steps as infrastructure noise, not proof that code passed or failed. A real code failure must still be fixed from local or Vercel build output.

## Main request flow

```text
api/dashboard.ts
  -> validates login/session
  -> api/dashboard-runtime.ts
  -> loads scoped Neon records
  -> @sales-automation/web/prospect-handler
  -> persists only changed records
```

Tender flow:

```text
api/tender-discovery.ts
  -> protected manual/cron request
  -> packages/prospect-discovery tender collectors
  -> strict source and procurement validation
  -> closeability scoring
  -> Jawad assignment
  -> Neon persistence
```

Outreach flow:

```text
api/cron/outreach.ts
  -> guarded configuration
  -> packages/outreach-email
  -> sales@codistan.org
  -> Reply-To assigned owner
  -> CC assigned owner + waseem@codistan.org
```

## Current priorities

Use the open GitHub backlog as the source of truth. The intended next work is focused on:

- Replacing temporary portfolio fixtures with an approved production catalog.
- Integrating authorized manual Upwork/LinkedIn source intake into the Prospect Desk and Neon, without scraping or auto-contact.
- Improving closeability ranking and outcome analytics.
- Improving source health, deliverability and CI observability.

Avoid broad framework rewrites. The current system already has working qualification, scoped access, routing, persistence, tender collection and guarded outreach.

## Pull request rules

- One coherent outcome per PR.
- Add regression tests for every production bug and source false positive.
- Never commit credentials or copied production data.
- Do not enable live outreach gates in code or examples.
- Do not add unauthorized scraping, LinkedIn auto-DM or Upwork auto-bidding.
- Keep external messages human-reviewed.
- State any required Vercel variable or migration clearly in the PR body.
- Confirm Production deployment before reporting a feature as live.

## Known technical debt

- Starter leads and portfolio proof still come from `packages/fixtures`; the portfolio portion should move to an approved managed catalog.
- Some server-rendered view files are large. Split them only when doing so reduces maintenance without changing behavior.
- The local repository implementation remains for development; Neon is the production source of truth.
- The compliant parser/ingestion packages are retained but are not yet connected to the current Prospect Desk UI.
- DNS and inbox placement must be verified before live outreach is enabled.
