import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('../..');
const worker = path.join(root, 'workers/acquisition');
const storage = fs.readFileSync(path.join(worker, 'acquisition_v4/storage.py'), 'utf8');
const runtime = fs.readFileSync(path.join(worker, 'acquisition_v4/runtime.py'), 'utf8');
const compose = fs.readFileSync(path.join(worker, 'local-postgres/docker-compose.yml'), 'utf8');
const common = fs.readFileSync(path.join(worker, 'scripts/windows/talenttrack-postgres-common.ps1'), 'utf8');
const enable = fs.readFileSync(path.join(worker, 'scripts/windows/enable-talenttrack-postgres.ps1'), 'utf8');
const check = fs.readFileSync(path.join(worker, 'scripts/windows/check-talenttrack-postgres.ps1'), 'utf8');
const backup = fs.readFileSync(path.join(worker, 'scripts/windows/backup-talenttrack-postgres.ps1'), 'utf8');
const restore = fs.readFileSync(path.join(worker, 'scripts/windows/restore-talenttrack-postgres.ps1'), 'utf8');
const start = fs.readFileSync(path.join(worker, 'scripts/windows/start-acquisition-v4.ps1'), 'utf8');
const installer = fs.readFileSync(path.join(worker, 'scripts/windows/install-acquisition-v4.ps1'), 'utf8');
const requirements = fs.readFileSync(path.join(worker, 'requirements.txt'), 'utf8').trim();

assert.equal(requirements, 'psycopg[binary]==3.3.4');

for (const marker of [
  'LOCAL_DATABASE_ENV = "TALENTTRACK_LOCAL_DATABASE_URL"',
  'class PostgresRecordStore',
  'backend = "postgresql"',
  'talenttrack_capture_records',
  'talenttrack_capture_seen',
  'talenttrack_capture_status',
  'PRIMARY KEY (source, dedupe_key)',
  'JSONL records are imported only when the source table is empty',
  'self.shadow.persist_records',
  'self.shadow.persist_seen',
  'self.shadow.persist_status',
  'create_record_store',
  'connect_timeout=5',
  'cursor.executemany',
]) assert(storage.includes(marker), `storage missing marker: ${marker}`);

for (const marker of [
  'from .storage import create_record_store',
  'self.store = create_record_store',
  '"storage_backend": self.store.backend',
  '"external_actions_enabled": False',
]) assert(runtime.includes(marker), `runtime missing marker: ${marker}`);
assert(!runtime.includes('TALENTTRACK_LOCAL_DATABASE_URL'));
assert(!runtime.includes('postgresql://'));

for (const marker of [
  'postgres:16-alpine',
  '127.0.0.1:${TALENTTRACK_POSTGRES_PORT:-55432}:5432',
  'codistan-talenttrack-postgres-data',
  'pg_isready',
]) assert(compose.includes(marker), `compose missing marker: ${marker}`);
assert(!compose.includes('0.0.0.0'));

for (const marker of [
  'local-postgres.env',
  'New-TalentTrackRandomSecret',
  'Protect-TalentTrackSecretFile',
  'TALENTTRACK_POSTGRES_PASSWORD',
  '^[A-Za-z0-9]{32,128}$',
  'Get-TalentTrackLocalDatabaseUrl',
  'Stop-TalentTrackRuntime',
  'Wait-TalentTrackCollectorBackend',
]) assert(common.includes(marker), `common PostgreSQL control missing marker: ${marker}`);

for (const marker of [
  'json_shadow_enabled = $true',
  'Invoke-TalentTrackCompose',
  'Wait-TalentTrackCollectorBackend -Backend "postgresql"',
  'Existing JSONL records were imported when the database was empty',
  'The database password and connection URL are not shown',
]) assert(enable.includes(marker), `enable workflow missing marker: ${marker}`);

for (const marker of [
  'storage_backend',
  'Collectors using PostgreSQL',
  'No password or connection URL was displayed',
]) assert(check.includes(marker), `check workflow missing marker: ${marker}`);

for (const marker of [
  'pg_dump',
  '--format=custom',
  'dockerPath cp',
  'Get-FileHash',
  'Protect-TalentTrackSecretFile',
  'json_shadow_enabled = $true',
]) assert(backup.includes(marker) || backup.toLowerCase().includes(marker.toLowerCase()), `backup workflow missing marker: ${marker}`);

for (const marker of [
  'RESTORE TALENTTRACK',
  'pre-restore safety backup',
  'dropdb',
  '--force',
  'createdb',
  'pg_restore',
  '--exit-on-error',
  'collectors remain stopped',
  'Wait-TalentTrackCollectorBackend -Backend "postgresql"',
]) assert(restore.includes(marker), `restore workflow missing marker: ${marker}`);

for (const marker of [
  'TALENTTRACK_LOCAL_DATABASE_URL',
  'storageBackend = "postgresql"',
  'Test-LocalPostgresReady',
  'Collectors remain stopped',
  'storage_backend -eq $storageBackend',
]) assert(start.includes(marker), `runtime launcher missing marker: ${marker}`);

for (const marker of [
  'requirements.txt',
  '-m pip install',
  'Enable TalentTrack Local PostgreSQL.lnk',
  'Check TalentTrack Local PostgreSQL.lnk',
  'Backup TalentTrack Local PostgreSQL.lnk',
  'Restore TalentTrack Local PostgreSQL.lnk',
  '$expectedBackend',
  'storage_backend -eq $expectedBackend',
]) assert(installer.includes(marker), `installer missing marker: ${marker}`);

const combined = `${storage}\n${runtime}\n${compose}\n${common}\n${enable}\n${check}\n${backup}\n${restore}\n${start}\n${installer}`.toLowerCase();
for (const prohibited of [
  'postgres_password=talenttrack',
  'talenttrack_postgres_password=talenttrack',
  'docker compose down -v',
  'docker volume rm',
  'remove-item $stateroot -recurse',
  'delete captured records',
  'external_actions_enabled": true',
  'captcha bypass',
  'navigator.webdriver',
]) assert(!combined.includes(prohibited), `local PostgreSQL implementation contains prohibited marker: ${prohibited}`);

for (const command of [
  'ENABLE-TALENTTRACK-POSTGRES.cmd',
  'CHECK-TALENTTRACK-POSTGRES.cmd',
  'BACKUP-TALENTTRACK-POSTGRES.cmd',
  'RESTORE-TALENTTRACK-POSTGRES.cmd',
]) {
  const content = fs.readFileSync(path.join(worker, command), 'utf8');
  assert(content.includes('exit /b %EXIT_CODE%'), `${command} must preserve its PowerShell exit code`);
}

console.log('TalentTrack local PostgreSQL contract passed.');
