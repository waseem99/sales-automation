# Sales Automation Release Identity

## Canonical identity

This repository is **Codistan Sales Automation**.

The production business-development application is **Prospect Desk**.

The Windows acquisition runtime, Upwork collector, LinkedIn warm-demand collector, Sales Navigator collector, identity/enrichment pipeline, BD workflow and outreach workbench are components of Codistan Sales Automation. They are not TalentTrack and do not rename the product.

## Repository ownership boundary

- `waseem99/sales-automation`: Codistan Sales Automation / Prospect Desk.
- `waseem99/content-automation`: separate content-automation system.

No TalentTrack product identity, command vocabulary, release document or workflow may be introduced into this repository.

## Compatibility vocabulary

Historical names such as Acquisition V4/V5, `acquisition_v4`, and Prospecting OS may remain temporarily in internal module names, branch names, report schemas or compatibility wrappers where renaming would create migration risk.

They must not be presented as the canonical product name in:

- release manifests;
- primary installer shortcuts;
- authoritative release documentation;
- pull-request titles;
- production dashboard identity;
- release tags.

## Merge gate

Before the acquisition release candidate may merge into `main`:

1. the release manifest must identify the product as Codistan Sales Automation;
2. canonical Windows commands and shortcuts must use Sales Automation or Acquisition Runtime vocabulary;
3. old Prospecting OS commands, when retained, must be marked compatibility aliases;
4. authoritative release documentation must use Sales Automation / Prospect Desk identity;
5. CI workflow display names must not identify the repository as TalentTrack;
6. a repository search and PR diff review must confirm no TalentTrack product artifacts are included;
7. all normal technical, Windows, source, synchronization and human-commercial gates must pass.

This document records the product boundary only. It does not authorize automatic external actions or bypass any live-pilot requirement.
