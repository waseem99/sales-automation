# Codistan Acquisition — On-Hold and Compatibility Registry

Nothing in this registry is deleted by the release-candidate work. A post-release retention review is required before removal.

| Item | State | Reason | Dependency / decision needed | Owner | Reactivation criteria | Last validated reference |
|---|---|---|---|---|---|---|
| `acquisition_v4` Python package name | superseded-reference / compatibility | The package contains the active supervisor and collectors, but its name is no longer the product version. Renaming it now would create unnecessary state and support risk. | Complete release acceptance, then decide whether internal package migration is worth the risk. | Engineering | A tested import migration with no installer, PID, watchdog, fixture or rollback regression. | Release candidate branch under issue #244 |
| V4/V5 `.cmd` and PowerShell scripts | compatibility aliases | Existing desktops and Startup shortcuts may still point to these paths. | Keep through one accepted release and publish neutral aliases. | Engineering / Operations | Remove only after diagnostics show no active shortcut or operator guide depends on them. | PR #223 / PR #225 stack |
| Historical V4/V5 documentation | superseded-reference | Contains useful decisions but conflicting operator instructions. | Move to archive/reference after accepted neutral operating guide is live. | Operations | One release cycle with the neutral guide used successfully. | `workers/acquisition/README.md` and historical pilot docs |
| Automatic external outreach | on-hold / not approved | Violates the current human-control policy and platform/account-safety boundary. | Explicit founder, legal/platform and security approval would be required. | Waseem | A separate approved design with account controls, audit, consent, rate limits and platform compliance. | Not implemented |
| Generic high-volume cold scraping | on-hold / not approved | Raw lead volume is not the objective and would degrade precision, duplicate risk and team capacity. | Evidence that a bounded source improves replies/meetings without quality loss. | Waseem / BD management | Representative reviewed sample with better downstream conversion than active lanes. | Not active |
| Stopped calibration lanes | on-hold by lane decision | A management `stop` decision intentionally pauses a lane. | Satisfy that decision's stored reactivation criteria. | Decision reviewer | New buyer trigger, revised targeting fixture and new controlled sample. | `/commercial-analytics` decision record |
| Experimental source adapters not listed in `RELEASE.json` | on-hold | Not approved for the release candidate. | Source-specific evidence, owner and acceptance plan. | Unassigned until approved | Added to the release manifest with a bounded collector and dedicated gate. | Repository history only |

## Policy

Every on-hold item must retain a reason, dependency, owner, reactivation criteria and last validated reference. On-hold is not the same as deleted, production-active or silently abandoned.
