# Release identity hold

The current acquisition release candidate is technically green but remains blocked from merge because `release-manifest.json`, canonical Windows commands, shortcuts and the authoritative RC document still present **Codistan Prospecting OS** as the product identity.

The canonical repository product is **Codistan Sales Automation**, with **Prospect Desk** as the production application.

Before merge, normalize the canonical release surface to Sales Automation / Acquisition Runtime vocabulary while preserving old Prospecting OS names only as documented compatibility aliases. See [`../SALES_AUTOMATION_RELEASE_IDENTITY.md`](../SALES_AUTOMATION_RELEASE_IDENTITY.md).
