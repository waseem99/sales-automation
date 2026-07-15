# Production release gate

## Authoritative gate

The production Vercel deployment is the enforced release gate for this repository.

Vercel runs the configured `buildCommand` from `vercel.json`:

```text
pnpm build:vercel
```

`build:vercel` must run both:

1. the complete TypeScript monorepo build; and
2. the production runtime smoke suite.

A change is not considered released until the corresponding `main` commit has a successful **Vercel** commit status. A failed production deployment must be corrected or reverted immediately.

## Local and manual verification

`pnpm deploy:check` is the full verification command for an environment with repository checkout and dependencies available. It performs installation, package builds, Vercel/API typechecking and runtime smoke checks.

## GitHub Actions status

The workflow is intentionally named **Repository CI (best effort)**. GitHub-hosted jobs in this repository have repeatedly failed before checkout with no steps or logs. Until GitHub reports normal executed steps reliably, that workflow is supplementary and must not replace the production Vercel gate.

When the workflow does execute, it runs the same `pnpm deploy:check` contract.

## Release verification procedure

For every merged change:

1. Confirm the exact `main` commit SHA.
2. Confirm the commit has a successful Vercel status.
3. Open `/operations` and compare its deployed commit with the expected `main` SHA.
4. For outreach or mailbox changes, review `/delivery-health` after the next hourly cycle.
5. Do not enable outbound sending unless DNS readiness, dry-run, ramp and human-approval gates are all satisfied.

## Failure handling

- **Vercel build failure:** release is blocked; diagnose, hotfix or revert.
- **Runtime smoke failure:** keep the feature code isolated and determine whether the feature or assertion failed before restoring the guard.
- **GitHub job with zero steps:** treat it as runner infrastructure failure, not proof of a code failure or success.
- **Delivery or IMAP warning:** retain human-reviewed outreach and investigate the privacy-safe event record in `/delivery-health`.
