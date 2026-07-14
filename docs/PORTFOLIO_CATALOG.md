# Managed Portfolio Proof Catalog

The production Prospect Desk uses the Neon-backed catalog at `/portfolio` rather than treating test fixtures as approved proof.

## Access

- All authenticated team members may view the catalog.
- Only Admin and Waseem may add, edit, approve, archive or change confidentiality.

## Approval rules

- `draft`: internal research only; excluded from evaluation and outbound drafting.
- `approved`: eligible for matching when asset health is not `broken`.
- `archived`: retained for audit/history but excluded from matching.
- `private`: remains excluded from normal evaluator matching and requires explicit do-not-disclose guidance.
- `public` or `anonymized`: may be used only with the exact approved proof statement and approved outreach paragraph.

## Required evidence

Approved records require:

- approver and approval timestamp;
- approved proof statement;
- service category and problem solved;
- confidentiality classification;
- asset-health status;
- instructions on what BD may share;
- do-not-disclose guidance where relevant.

Broken assets remain visible to administrators but are excluded from production matching.

## Starter records

The repository seeds conservative public capability records for Codistan, Hilarious AI and Cytas. These records make no named-client, ROI, certification or performance claims. Motionly remains a draft until an approved public or anonymized showreel/profile asset is attached.

New project-specific case studies should be added through `/portfolio`; no code deployment is required.
