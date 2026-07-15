# Protected Route Runtime Contract

## Purpose

The Prospect Desk has one authenticated Vercel entrypoint, but several specialized server-rendered runtimes. The protected-route contract makes the route inventory, access expectations, runtime target and failure behavior explicit and testable.

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

Each entry records the HTTP method, a representative path, the target runtime, expected response type and allowed roles.

## Runtime boundaries

`api/dashboard.ts` remains the single authenticated entrypoint. Specialized runtime modules are loaded with `loadRuntimeBoundary()` so a failed ESM import is associated with a named operation and handled by the same safe error contract.

Do not add a top-level `@sales-automation/*` runtime import to a CommonJS-sensitive Vercel boundary. Type-only imports are allowed where they are erased at build time.

## Authorization contract

- Public: health and login routes only.
- Admin/Waseem: all company data and protected mutations.
- Team lead: team-scoped data and non-administrative workspaces.
- BD user: owner-scoped data and non-administrative workspaces.

Authorization remains enforced in the runtime and Neon queries. The route contract is a regression and documentation layer, not a replacement for server-side access checks.

## Failure contract

Unexpected runtime failures return:

- HTTP 500;
- a non-sensitive `x-runtime-reference` header;
- the failed operation name;
- a safe retry/navigation path for HTML responses;
- no database URL, stack trace, credentials, private message or buyer data.

Detailed messages and stacks are logged server-side with the same reference ID.

## Release gate

Run:

```bash
pnpm test:protected-routes
pnpm deploy:check
```

The protected-route smoke test verifies:

- unique route contract entries;
- representative route resolution;
- unauthenticated HTML redirects and API rejection;
- Admin/Waseem, team-lead and BD access classification;
- admin-only mutation permissions;
- safe HTML and JSON runtime error responses.

A production merge still requires a successful Vercel deployment and manual verification of the key authenticated routes. The test does not connect to production Neon or send external communication.

## Deployment discipline

Route-contract, runtime-boundary, authorization and documentation changes should normally ship together in one focused PR. This prevents multiple preview deployments for one tightly coupled runtime change. Production deployment occurs only after the full local/CI release gate is green.
