# Protected Route Runtime Contract

## Purpose

The Prospect Desk has one production application with dashboard-routed workspaces and several dedicated protected serverless handlers. The protected-route contract makes the route inventory, access expectations, runtime target and failure behavior explicit and testable.

The authoritative machine-readable definition is `vercel/runtime-contract.ts`.

## Route groups

The contract covers:

- `/prospects`
- `/priorities`
- `/leads/*`
- `/services/*`
- `/lead-signals`
- `/linkedin-signals`
- `/tenders`
- `/portfolio`
- `/re-engagement`
- `/operations`
- `/delivery-health`
- protected portfolio, source-control and closeability API actions

Each entry records the HTTP method, a representative path, the target runtime, expected response type and allowed roles. Dedicated handlers are marked separately from routes served through `api/dashboard.ts`.

## Runtime boundaries

Dashboard-routed workspaces enter through `api/dashboard.ts`. Its contract module is itself loaded at request time so the CommonJS-sensitive Vercel entrypoint keeps no new top-level runtime dependency. Specialized modules then load through `loadRuntimeBoundary()` so a failed ESM import is associated with a named operation and handled by the same safe error contract.

The dedicated protected functions remain separate Vercel entrypoints and are invoked directly by the post-build smoke test.

Do not add a top-level `@sales-automation/*` runtime import to a CommonJS-sensitive Vercel boundary. Type-only imports are allowed where they are erased at build time.

## Authorization contract

- Public: health and login routes only.
- Admin/Waseem: all company data, Signal Intake, LinkedIn Signals, Re-engagement, Delivery Health and protected mutations.
- Team lead: team-scoped data and non-administrative workspaces.
- BD user: owner-scoped data and non-administrative workspaces.

Authorization remains enforced in the runtime and Neon queries. The route contract is a regression and documentation layer, not a replacement for server-side access checks.

## Failure contract

Unexpected dashboard runtime failures return:

- HTTP 500;
- a non-sensitive `x-runtime-reference` header;
- the failed operation name;
- a safe retry/navigation path for HTML responses;
- no database URL, stack trace, credentials, private message or buyer data.

Detailed messages and stacks are logged server-side with the same reference ID. A local safe fallback remains available if the shared contract module itself cannot load.

## Release gate

Run:

```bash
pnpm test:protected-routes
pnpm deploy:check
```

The protected-route smoke test verifies:

- unique route contract entries;
- representative route resolution;
- dashboard-routed and dedicated handler module loading;
- unauthenticated HTML redirects and API rejection;
- Admin/Waseem, team-lead and BD access classification;
- synthetic signed team-lead and BD sessions receive direct HTTP 403 responses from every Admin-only dedicated handler;
- admin-only workspace and mutation permissions;
- safe HTML and JSON runtime error responses.

## Sanitized production acceptance

After a production deployment, run the credential-driven acceptance runner from a secure local shell:

```bash
PRODUCTION_ACCEPTANCE_BASE_URL=https://your-production-host \
PRODUCTION_ACCEPTANCE_ADMIN_PASSWORD='...' \
PRODUCTION_ACCEPTANCE_TEAM_LEAD_PASSWORD='...' \
PRODUCTION_ACCEPTANCE_BD_PASSWORD='...' \
pnpm tsx scripts/production-route-acceptance.ts
```

The default account identifiers are `admin`, `talha.bashir@codistan.org` and `hibasohail@codistan.org`. Override them only when a different configured account is required:

```text
PRODUCTION_ACCEPTANCE_ADMIN_IDENTIFIER
PRODUCTION_ACCEPTANCE_TEAM_LEAD_IDENTIFIER
PRODUCTION_ACCEPTANCE_BD_IDENTIFIER
```

The runner verifies login role/scope, session continuity, the shared authenticated workspaces and the Admin-only dedicated workspaces. It prints only role labels, route paths and HTTP status codes. It never prints passwords, account identifiers, cookies, response bodies or lead data. These credentials are temporary shell inputs and must not be committed or added as Vercel project variables.

A production merge still requires a successful Vercel deployment. The automated build smoke does not connect to production Neon or send external communication, and the production acceptance runner performs read-only GET checks after login.

## Deployment discipline

Route-contract, runtime-boundary, authorization and documentation changes should normally ship together in one focused PR. This prevents multiple preview deployments for one tightly coupled runtime change. Production deployment occurs only after the full local/CI release gate is green.
