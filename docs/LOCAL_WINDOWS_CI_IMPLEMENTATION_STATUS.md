# Local CI implementation status

Implemented on PR #219:

- LinkedIn Sales Navigator CI routes to `[self-hosted, Windows, X64, codistan-local]`.
- The workflow is currently queued and waiting for the matching runner.
- Local PostgreSQL preflight resolves `LOCAL_DATABASE_URL` from a repository secret or Windows machine variable.
- The connection string is masked before logs are written.
- `psql.exe` is discovered from PATH or standard PostgreSQL installation folders.
- Package installation and tests do not start until the local database login succeeds.
- `SETUP-LOCAL-CI-RUNNER.cmd` bootstraps the database and runner.
- `CHECK-LOCAL-CI.cmd` verifies the runner, PostgreSQL, database login, Node.js and Git.
- The runner installer downloads the latest official Windows x64 runner release and registers `Codistan-PC` as a Windows service with the `codistan-local` label.
- The PostgreSQL bootstrap creates a dedicated `sales_automation_ci` role and database, generates a local password and stores the connection only as a Windows machine-level environment variable.

Remaining machine actions:

1. Install PostgreSQL locally when it is not already installed.
2. Obtain a temporary runner registration token from GitHub Settings → Actions → Runners.
3. Run `SETUP-LOCAL-CI-RUNNER.cmd` as Administrator.
4. Confirm `Codistan-PC` appears online and the queued workflow begins.
5. Review real build/test output before taking PR #219 out of draft.
