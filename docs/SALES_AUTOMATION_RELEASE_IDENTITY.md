# Sales Automation Release Identity

## Canonical identity

This repository is **Codistan Sales Automation**.

The production business-development application is **Prospect Desk**.

The Windows acquisition runtime, Upwork collector, LinkedIn warm-demand collector, Sales Navigator collector, identity/enrichment pipeline, BD workflow and outreach workbench are components of Codistan Sales Automation. They do not rename the product.

## Compatibility vocabulary

Historical Acquisition V4/V5 names and older hyphenated prospecting command filenames may remain only where changing them would break an existing installation or link.

They must not be presented as the canonical product name in release manifests, installer shortcuts, authoritative documentation, pull-request titles, production dashboard identity or release tags.

Every retained historical command must be an explicitly labelled compatibility alias that delegates to a canonical Sales Automation command.

## Merge gate

Before the acquisition release candidate may merge into `main`:

1. the release manifest must identify **Codistan Sales Automation** and **Prospect Desk**;
2. canonical Windows commands and shortcuts must use Sales Automation vocabulary;
3. historical command aliases must delegate to canonical commands;
4. authoritative release documentation must use Sales Automation / Prospect Desk identity;
5. CI workflow display names must use the canonical identity;
6. the repository identity guard and all technical checks must pass on the exact head;
7. Windows, source, synchronization and human-commercial gates must pass.

This document records the product boundary only. It does not authorize automatic external actions or bypass any live-pilot requirement.
