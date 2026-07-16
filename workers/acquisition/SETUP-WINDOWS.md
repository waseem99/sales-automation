# Windows First-Time Setup

This guide is for a nontechnical operator. The setup is local-first: account passwords, cookies, OTPs and browser profiles stay on the Windows computer and are not committed to GitHub.

## What the operator does

1. Open the `workers/acquisition` folder.
2. Double-click `START-HERE.cmd`.
3. Allow Windows to install Python 3.12 if prompted.
4. Wait while Chromium and the acquisition worker are installed and tested.
5. An Upwork browser window opens. Log in inside that browser, complete any verification, confirm the Find Work page is visible, return to the setup window and press Enter.
6. A separate LinkedIn Sales Navigator browser window opens. Log in, complete any verification, confirm Sales Navigator is visible, return to the setup window and press Enter.

That is the full first-time operator workflow.

## Important safety rules

- Type passwords and OTPs only into the official Upwork or LinkedIn browser pages.
- Never paste passwords, cookies, recovery codes, OTPs or browser profile folders into ChatGPT, GitHub, email or WhatsApp.
- Do not copy the `%LOCALAPPDATA%\Codistan\Acquisition\profiles` folder to another person or computer.
- The current worker does not submit Upwork proposals or send LinkedIn messages, InMails or connection requests.
- Account or verification challenges always require the operator.

## Local storage

The setup creates private local state under:

```text
%LOCALAPPDATA%\Codistan\Acquisition
```

It contains:

- `profiles\upwork` — authorized Upwork Chromium profile;
- `profiles\linkedin-sales-navigator` — authorized LinkedIn Chromium profile;
- `output` — future reviewed dry-run opportunity output;
- `checkpoints` — resumable source-run checkpoints;
- `settings.json` — non-sensitive local path configuration.

These folders are outside the repository.

## Reconnecting an account

Double-click `CONNECT-ACCOUNTS.cmd` to reopen both guided account-profile sessions. This does not send any external action.

## What comes next

Account connection only establishes authorized local browser profiles. Before live opportunity research starts, the source-specific adapter must validate the authenticated pages and complete a reviewed dry run. Upwork is the first source pilot; LinkedIn follows after the Upwork quality gate.

## Support information to share

When reporting a setup problem, share:

- the visible error message;
- the step at which it stopped;
- whether Windows requested installation permission;
- whether the official account page opened.

Do not share screenshots containing passwords, OTPs, cookies, recovery codes or private account information.
