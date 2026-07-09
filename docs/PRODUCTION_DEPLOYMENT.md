# Production Deployment Architecture

## Decision

Use a containerized Node web service for the real Codistan Lead Desk app.

The current Vercel preview branch is useful for browser review, but it is intentionally a standalone preview workaround. The production path should run the real monorepo web app from `apps/web`.

Recommended first production target: **Render / Railway / Fly / any Docker-capable Node host**.

## Delivery and cost-control rules

To keep development velocity high and deployment spend controlled:

1. Keep only one active implementation PR at a time.
2. Batch related Sprint 2 work into one PR when the work is mainly infra/planning/doc/skeleton work.
3. Do not create a new PR for every tiny issue.
4. Use GitHub CI as the normal review gate.
5. Do not depend on manual local review.
6. Avoid Vercel preview deployments for ordinary feature branches.
7. Use Vercel only for the existing lightweight preview path or selected demo branches.
8. Use Docker/Render/Railway/Fly for the real Node app deployment.

## Vercel deployment guard

`vercel.json` uses an ignore command so non-preview branches can be skipped by Vercel.

Allowed Vercel refs:

```text
main
fix-vercel-preview
```

All other branches should be reviewed through GitHub CI unless we intentionally allow a demo deployment.

## Why this path

The actual app is a Node HTTP server in `apps/web`, not a static frontend or Next.js app. A containerized Node service lets us run the real server directly without reshaping the product around Vercel serverless functions.

This also keeps the next integrations safer because Gmail, database, enrichment, and alert providers can be introduced later through environment variables and deployment secrets without changing the hosting model.

## Runtime behavior

The service starts with:

```bash
pnpm start:web
```

That runs:

```bash
node apps/web/dist/dev.js
```

Current runtime is still demo/sample-data-first:

- Seeds safe sample leads if the local store is empty.
- Uses `LOCAL_LEAD_STORE_PATH` for local JSON persistence.
- Does not connect Gmail, LinkedIn, Upwork, scraping, enrichment, sending, or CRM providers.
- Keeps the dev founder token only for demo/internal form submissions.

## Environment variables

Required for the current deployment:

```text
NODE_ENV=production
PORT=3000
LOCAL_LEAD_STORE_PATH=/data/leads.json
```

Future credentials must be configured only as deployment secrets, not committed to the repo.

## Health check

Use:

```text
/health
```

Expected JSON:

```json
{
  "ok": true,
  "service": "sales-automation-web"
}
```

## Render blueprint

`render.yaml` is included as a first deployable option.

It uses:

- Docker runtime
- `Dockerfile`
- `/health` health check
- `/data/leads.json` for demo persistence
- 1GB persistent disk mounted at `/data`

## Docker deployment

Build:

```bash
docker build -t codistan-lead-desk .
```

Run:

```bash
docker run --rm \
  -p 3000:3000 \
  -e PORT=3000 \
  -e LOCAL_LEAD_STORE_PATH=/data/leads.json \
  -v codistan-lead-desk-data:/data \
  codistan-lead-desk
```

Open:

```text
http://localhost:3000
```

## Rollback notes

If deployment fails:

1. Roll back to the previous service revision in the hosting dashboard.
2. Keep PR #28 available as a preview-only browser review fallback.
3. Do not add real external credentials until the real app deployment is stable.

## Not included yet

- Production database
- Real production authentication provider
- Gmail API runtime connection
- LinkedIn/Sales Navigator API connection
- Enrichment provider connection
- Slack/WhatsApp/email alert sending
- Upwork auto-bidding
- LinkedIn auto-DM

All external communication remains human-approved and out of scope for this deployment step.
