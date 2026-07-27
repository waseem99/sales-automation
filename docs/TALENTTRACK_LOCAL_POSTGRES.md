# TalentTrack Local PostgreSQL

## Purpose

TalentTrack Pilot can keep Windows acquisition records in a local PostgreSQL service instead of using JSONL as the primary capture store. This is an optional operator-controlled mode for the office pilot.

It does not replace or modify the PostgreSQL/Neon production boundary used by Prospect Desk. It only changes where the three local collectors retain their captured source records before synchronization.

## Safety model

- JSONL remains the default until an operator runs `ENABLE-TALENTTRACK-POSTGRES.cmd`.
- PostgreSQL binds only to `127.0.0.1`, on port `55432` by default.
- Docker uses a named volume and no implementation command removes that volume.
- The database password is generated locally and stored in `%LOCALAPPDATA%\Codistan\Acquisition\config\local-postgres.env`.
- The secret file and native backups are restricted to the current Windows user.
- The password and connection URL are never written to collector health, backup metadata or normal status output.
- Once enabled, PostgreSQL is fail-closed. If Docker or the database is unavailable, collectors remain stopped rather than silently writing a divergent JSON history.
- Every committed PostgreSQL record, seen fingerprint and status update is mirrored to the existing JSON files as a rollback shadow.
- Existing JSONL records are imported only when the corresponding PostgreSQL source table is empty.
- External proposal, messaging, InMail, connection, follow, reaction, comment and email actions remain disabled.

## Requirements

1. TalentTrack Pilot is installed through `START-HERE-TALENTTRACK.cmd`.
2. Docker Desktop is installed and running.
3. The current Windows user can run `docker compose version`.

The TalentTrack installer pins and installs the supported Psycopg binary package for Python 3.12. PostgreSQL itself runs in the repository-provided `postgres:16-alpine` container.

## Enable

Run:

```text
ENABLE-TALENTTRACK-POSTGRES.cmd
```

The command:

1. validates Docker Desktop and Compose;
2. generates a 48-character local password when no configuration exists;
3. restricts the secret file to the current user;
4. starts the loopback-only PostgreSQL service;
5. waits for `pg_isready`;
6. stops the current TalentTrack collectors;
7. restarts them with PostgreSQL enabled;
8. imports existing JSONL records when the database is empty;
9. confirms all three collectors report `storage_backend=postgresql`.

No JSON files are deleted.

## Check

Run:

```text
CHECK-TALENTTRACK-POSTGRES.cmd
```

The check reports:

- Docker service state;
- local host, port and database name;
- readiness;
- each collector's non-secret storage-backend label;
- whether all three collectors use PostgreSQL.

It does not display the password or connection URL.

## Backup

Run:

```text
BACKUP-TALENTTRACK-POSTGRES.cmd
```

Backups are written to:

```text
%LOCALAPPDATA%\Codistan\Acquisition\backups
```

Each backup contains:

- a PostgreSQL custom-format `.dump` file;
- adjacent non-secret JSON metadata;
- SHA-256 checksum;
- creation time, byte count and database name.

The dump is created inside the container with `pg_dump --format=custom`, copied with `docker cp`, then removed from the container. This avoids unsafe binary output redirection through Windows PowerShell.

## Restore

Run:

```text
RESTORE-TALENTTRACK-POSTGRES.cmd
```

The restore workflow:

1. selects a `.dump` file;
2. verifies its checksum when metadata exists;
3. requires the exact confirmation `RESTORE TALENTTRACK`;
4. creates and verifies a new pre-restore safety backup;
5. stops all three collectors;
6. recreates the local database;
7. runs `pg_restore --exit-on-error --no-owner`;
8. restarts collectors only after successful restore;
9. waits for all collectors to reconnect on PostgreSQL;
10. refreshes the JSON rollback shadow from the restored database.

If restoration fails, collectors remain stopped to avoid writes into a partial database. The pre-restore safety backup path is displayed.

## Upgrade and rollback

Running `START-HERE-TALENTTRACK.cmd` after PostgreSQL is enabled:

- preserves the Docker volume;
- preserves the local secret configuration;
- preserves native backups;
- installs the pinned Python driver;
- starts PostgreSQL through the existing configuration;
- requires all collectors to report the expected PostgreSQL backend;
- restores the previous application package if the upgraded runtime does not become healthy.

`ROLLBACK-TALENTTRACK.cmd` restores application files only. The database volume, backup files, local secret configuration and JSON rollback shadow remain outside `app-current` and `app-previous`.

## Disable or return to JSON

Automatic fallback is intentionally not implemented. Returning to JSON must be a separate controlled operation after verifying that the JSON shadow is current and taking a native PostgreSQL backup. Do not delete the Docker volume or `local-postgres.env` as an improvised disable procedure.

## Developer validation

The dedicated CI uses a real PostgreSQL service and validates:

- schema creation;
- one-time JSON import;
- PostgreSQL-authoritative restart;
- JSON rollback-shadow updates;
- status and seen-fingerprint retention;
- absence of secrets in collector health;
- Docker loopback binding;
- PowerShell parser validity;
- installer, enable, check, backup and restore contracts;
- existing Upwork, LinkedIn, Sales Navigator and Prospect Desk regressions;
- full production build.
