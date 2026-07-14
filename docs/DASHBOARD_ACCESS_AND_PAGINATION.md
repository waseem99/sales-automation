# Dashboard Access and Pagination

## Purpose

The Prospect Desk uses identity-based lead visibility and server-side Neon queries so users only receive records they are authorized to see. UI hiding is not treated as an access control.

## Access scopes

| Account | Visibility | Global operations |
|---|---|---|
| Admin | All leads | Allowed |
| Waseem Khan (`waseem@codistan.org`) | All leads | Allowed |
| Talha Bashir | Talha, Danish, Hiba and Bilal assignments | Not allowed |
| Jawad Jutt | Own assigned leads | Not allowed |
| Moiz Khalid | Own assigned leads | Not allowed |
| Subaina Aamir | Own assigned leads | Not allowed |
| Danish Khalid | Own assigned leads | Not allowed |
| Hiba Sohail (`hibasohail@codistan.org`) | Own assigned leads | Not allowed |
| Bilal Ahmed (`bilalahmed@codistan.org`) | Own assigned leads | Not allowed |

Talha continues to see Hiba and Bilal assignments. Hiba and Bilal can sign in after their dashboard password variables are configured in Vercel. Legacy owner values such as `hiba` and `bilal` remain recognized and are mapped to their approved Codistan email accounts.

## Global operations

The following actions are restricted to Admin and Waseem:

- Load the verified starter collection.
- Run public prospect discovery.
- Run engagement-guidance backfills.
- Synchronize the PSEB Tech Hub collection.
- Use legacy ingestion and development-reset routes.

These restrictions are enforced before the request reaches the legacy API handlers.

## Server-side pagination

The production dashboard queries Neon directly with page sizes of **25**, **50**, or **100** records. The query applies access scope and filters before applying `LIMIT` and `OFFSET`.

Supported server filters:

- Search text.
- Pipeline status.
- Opportunity signal.
- Service category.
- Owner.
- Feedback status.

The response includes:

- Visible total for the signed-in account.
- Filtered total.
- Current result range.
- Current page and total pages.
- Owner values available inside the user's scope.

## Targeted record loading

Individual lead reads and updates load only the requested Neon record and verify it against the signed-in user's owner scope. Successful updates persist only the changed record. Unauthorized IDs return `404` so the API does not reveal whether an inaccessible record exists.

The legacy Lead Desk receives a scoped repository rather than the complete database. Global legacy ingestion routes are blocked for non-admin accounts.

## PSEB synchronization

The **Sync PSEB collection** action reads the public PSEB Tech Hub page, extracts company website profiles, creates idempotent partnership prospects, evaluates them through the existing sales engine, and persists new records to Neon.

The sync uses the official public page and requires no new environment variables. It is human-triggered and does not contact any listed company.

After the deployment, Admin or Waseem should run **Sync PSEB collection** once from the Prospect Desk.

## Environment variables

The dashboard account variables are:

- `ADMIN_PASSWORD`
- `WASEEM_DASHBOARD_PASSWORD`
- `TALHA_DASHBOARD_PASSWORD`
- `JAWAD_DASHBOARD_PASSWORD`
- `MOIZ_DASHBOARD_PASSWORD`
- `SUBAINA_DASHBOARD_PASSWORD`
- `DANISH_DASHBOARD_PASSWORD`
- `HIBA_DASHBOARD_PASSWORD`
- `BILAL_DASHBOARD_PASSWORD`
- `SESSION_SECRET`
- `DATABASE_URL`

Add dashboard password variables to the same Vercel environments used by the team, then redeploy so the new deployment receives the updated values.

## Verification checklist

1. Sign in as Admin and confirm all leads and all global buttons are visible.
2. Sign in as Waseem and confirm the same full scope.
3. Sign in as Talha and confirm only Talha/Danish/Hiba/Bilal assignments are returned.
4. Sign in as Jawad, Moiz, Subaina, Danish, Hiba and Bilal and confirm each account sees only its own assignments.
5. Attempt a global route as a non-admin account and confirm `403`.
6. Confirm page size options 25, 50 and 100 preserve active filters.
7. Confirm direct access to an out-of-scope lead returns `404`.
8. Run PSEB synchronization once as Admin or Waseem and review imported prospects before outreach.
