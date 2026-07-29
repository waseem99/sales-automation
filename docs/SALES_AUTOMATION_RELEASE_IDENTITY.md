# Sales Automation Release Identity

## Canonical identity

This repository is **Codistan Sales Automation**.

The production business-development application is **Prospect Desk**.

The Windows acquisition runtime, Upwork collector, LinkedIn warm-demand collector, Sales Navigator collector, identity/enrichment pipeline, BD workflow and outreach workbench are components of Codistan Sales Automation. They do not rename the product.

## Compatibility vocabulary

Historical Acquisition V4/V5 names and older hyphenated prospecting command filenames remain only where changing them would break an existing installation or link.

They are not presented as the canonical product name in release manifests, installer shortcuts, authoritative documentation, pull-request titles, production dashboard identity or release tags.

Every retained historical command is an explicitly labelled compatibility alias that delegates to a canonical Sales Automation command.

## Enforced repository contract

The exact-head repository identity test verifies:

1. the release manifest identifies **Codistan Sales Automation** and **Prospect Desk**;
2. canonical Windows commands, reports and shortcuts use Sales Automation vocabulary;
3. retained historical aliases delegate to canonical commands;
4. authoritative release documentation lives under `docs/sales-automation`;
5. CI workflow display names use the canonical identity;
6. unrelated product or repository identities are absent from tracked files;
7. the identity guard runs within the normal repository deployment check.

## Remaining merge gates

Identity normalization is complete. The release candidate must still remain draft until Windows installation/upgrade/rollback, live source pilots, Prospect Desk synchronization and the human commercial-review gate pass.

This document does not authorize automatic external actions or bypass any live-pilot requirement.
