# Codistan Upwork Opportunity Capture 1.1.0

This Manifest V3 extension captures jobs only from the three approved Codistan Upwork saved searches and submits them to the local collector on `127.0.0.1:8765`.

## Supported searches

| Profile owner | Saved search | Approved URL |
|---|---|---|
| Waseem | AI + Fullstack AI 16 July 2026 | `https://www.upwork.com/nx/find-work/9652811` |
| Roshana | 3D Design & Creatives 15 July 2026 | `https://www.upwork.com/nx/find-work/9652860` |
| Nadir | Game & AR/VR 16 July 2026 | `https://www.upwork.com/nx/find-work/9652877` |

A redirected, renamed or unrelated find-work page is not accepted as a scheduled search.

## Operating modes

### Visible-page capture

When an operator opens an approved saved search in the normal logged-in Chrome session, the extension reads visible cards and submits them automatically. The popup also retains **Capture this visible page** as a fallback.

### Manual all-search pilot

**Run all approved searches now** opens the three approved URLs sequentially in inactive temporary tabs. For each search it:

1. waits for the normal Upwork page to load;
2. verifies the exact approved search path;
3. reads the first visible result window;
4. scrolls up to four bounded steps;
5. merges up to 30 canonical jobs;
6. submits one batch to the local collector;
7. restores the original scroll position;
8. closes the temporary tab.

The manual all-search pilot works while routine scheduling is disabled.

### Routine schedule

Routine automation runs every 15 minutes only after the operator explicitly enables it from the popup. Version 1.1.0 disables scheduling automatically on first installation or policy upgrade so a live manual pilot can be inspected before unattended cycles begin.

Closing Chrome, signing out of Upwork or disabling the toggle stops routine operation. Login, verification, challenge and unexpected redirects are reported and never bypassed.

## Diagnostics

Each search reports:

- visible job links and candidate cards;
- unique canonical jobs submitted;
- scroll steps and selected scroll container;
- stop reason;
- new, duplicate, enriched and rejected counts;
- profile owner and saved-search identity;
- explicit failure reason where applicable.

The local collector remains responsible for source persistence, qualification, deduplication, enrichment and Prospect Desk synchronization.

## Safety boundary

The extension does not:

- open job-detail pages;
- click job or client controls;
- submit a proposal;
- send a message;
- change an Upwork profile;
- interact with login, verification or challenge pages;
- copy browser credentials, cookies or private session data;
- bypass Upwork controls or limits.

Every capture payload sets `external_action_performed: false`.
