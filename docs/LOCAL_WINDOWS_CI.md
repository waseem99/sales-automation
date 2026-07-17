# Local Windows CI for Sales Automation

## Purpose

Run the LinkedIn Sales Navigator build and test gate on Codistan's Windows PC instead of GitHub-hosted infrastructure, and use a PostgreSQL instance installed on the same PC for local CI database access.

This setup is for development and CI. The deployed Vercel application must continue using a remotely reachable production database; Vercel cannot connect to `127.0.0.1` on the office PC.

## Final local architecture

```text
Windows PC
├── GitHub Actions self-hosted runner: Codistan-PC
├── Required custom runner label: codistan-local
├── PostgreSQL Windows service
├── Database: sales_automation_ci
├── Role: sales_automation_ci
└── Machine variable: LOCAL_DATABASE_URL
```

The workflow resolves the database connection in this order:

1. GitHub repository secret `LOCAL_DATABASE_URL`, when configured.
2. Windows machine-level environment variable `LOCAL_DATABASE_URL`.

No database password is committed to GitHub.

## Prerequisites

- Windows 10/11 x64 or a supported Windows Server version.
- Administrator access on the runner PC.
- Git installed.
- PostgreSQL installed locally.
- The PostgreSQL `postgres` administrator password.
- Repository-owner access to create a GitHub self-hosted runner.

PostgreSQL for Windows can be installed from:

```text
https://www.postgresql.org/download/windows/
```

## One-click setup

From the repository branch containing this implementation, right-click and run as Administrator:

```text
SETUP-LOCAL-CI-RUNNER.cmd
```

The launcher performs these steps:

1. Detect PostgreSQL and start its Windows service when necessary.
2. Prompt securely for the local PostgreSQL administrator password.
3. Create or update the `sales_automation_ci` login role.
4. Create or update the `sales_automation_ci` database.
5. Generate a random local CI password.
6. Store the connection string in the machine-level `LOCAL_DATABASE_URL` variable.
7. Verify an application-role database login.
8. Download the latest official Windows x64 GitHub Actions runner.
9. Prompt for GitHub's temporary runner registration token.
10. Register `Codistan-PC` with label `codistan-local`.
11. Install and start the runner as an automatic Windows service.
12. Run the local CI health checker.

## Getting the temporary runner token

Immediately before the runner-registration part of the installer:

1. Open the repository on GitHub.
2. Go to **Settings**.
3. Expand **Actions** and choose **Runners**.
4. Click **New self-hosted runner**.
5. Select **Windows** and **x64**.
6. Find the `config.cmd` command GitHub displays.
7. Copy only the temporary value appearing after `--token`.
8. Paste it into the secure prompt opened by the installer.

The token is short-lived. Do not put it in a repository file, screenshot or chat message.

## Workflow routing

The Sales Navigator workflow now requires all four labels:

```yaml
runs-on: [self-hosted, Windows, X64, codistan-local]
```

A different runner will not pick up the job unless it has the custom `codistan-local` label.

## Database preflight

Before package installation or tests, the workflow:

1. Resolves `LOCAL_DATABASE_URL`.
2. Masks the complete connection string in the Actions log.
3. Finds `psql.exe` from PATH or the normal PostgreSQL installation folders.
4. Connects to the configured local database.
5. Prints only the database and user names.
6. Stops immediately when the database is unavailable.

## Health check

Run:

```text
CHECK-LOCAL-CI.cmd
```

It verifies:

- a GitHub Actions runner service exists and is running;
- PostgreSQL is installed and running;
- the machine-level database variable is configured;
- `psql.exe` can connect using the application role;
- Node.js is available;
- Git is available.

## Triggering CI

After GitHub shows `Codistan-PC` as **Idle**:

1. Open **Actions**.
2. Choose **LinkedIn Sales Navigator CI**.
3. Open the latest run or choose **Run workflow**.
4. The runner status will change from **Idle** to **Active**.

The workflow runs:

- workspace dependency installation;
- package builds;
- Vercel TypeScript checks;
- unified signal-mailbox tests;
- automatic Sales Navigator discovery tests;
- Vercel runtime contract tests.

## Local database reset

Rerunning `scripts/windows/setup-local-postgres-ci.ps1` is idempotent. It retains the database, resets the application-role password, updates `LOCAL_DATABASE_URL`, verifies access and restarts the runner service.

To use different names:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/windows/setup-local-postgres-ci.ps1 `
  -DatabaseName sales_automation_ci `
  -DatabaseUser sales_automation_ci `
  -Port 5432
```

## Security and operating boundary

- Keep the repository private while using an office PC as a self-hosted runner.
- Do not use the local database as Vercel's production database.
- Do not expose PostgreSQL port 5432 to the public internet.
- Keep Windows, PostgreSQL, Git and Node.js updated.
- Use the dedicated custom runner label.
- Keep external LinkedIn actions human-reviewed.
- A workflow from this repository can execute commands on the runner PC, so merge access must remain restricted.

## Removal

To remove the runner safely:

1. Go to GitHub **Settings → Actions → Runners**.
2. Open `Codistan-PC` and choose **Remove**.
3. Use the removal token with `C:\actions-runner\config.cmd remove`.
4. Delete `C:\actions-runner` only after removal completes.

To remove only the local CI connection variable from an Administrator PowerShell window:

```powershell
[Environment]::SetEnvironmentVariable('LOCAL_DATABASE_URL', $null, 'Machine')
```
