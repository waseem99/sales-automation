import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve('../..');
const workerRoot = path.join(repoRoot, 'workers/acquisition');
const release = JSON.parse(fs.readFileSync(path.join(workerRoot, 'RELEASE.json'), 'utf8'));
const readme = fs.readFileSync(path.join(workerRoot, 'README.md'), 'utf8');
const baseline = fs.readFileSync(path.join(repoRoot, 'docs/TALENTTRACK_RELEASE_BASELINE.md'), 'utf8');
const postgresGuide = fs.readFileSync(path.join(repoRoot, 'docs/TALENTTRACK_LOCAL_POSTGRES.md'), 'utf8');
const installer = fs.readFileSync(path.join(workerRoot, 'scripts/windows/install-acquisition-v4.ps1'), 'utf8');

assert.equal(release.product, 'TalentTrack Pilot');
assert.equal(release.product_version, '1.0.0');
assert.equal(release.runtime_version, '0.3.1');
assert.equal(release.release_status, 'live_validation');
assert.equal(release.state_root, '%LOCALAPPDATA%\\Codistan\\Acquisition');
assert.equal(release.internal_runtime_package, 'acquisition_v4');
assert.equal(release.storage.default_backend, 'jsonl');
assert.equal(release.storage.production_prospect_desk, 'postgresql');
assert.equal(release.storage.optional_local_postgres.host, '127.0.0.1');
assert.equal(release.storage.optional_local_postgres.default_port, 55432);
assert.equal(release.storage.optional_local_postgres.json_rollback_shadow, true);
assert.equal(release.storage.optional_local_postgres.automatic_fallback, false);
assert.equal(release.legacy_compatibility.enabled, true);
assert.equal(release.external_action_policy.automatic_sending, false);
assert.equal(release.external_action_policy.upwork_submission, false);
assert.equal(release.external_action_policy.linkedin_messaging, false);
assert.equal(release.external_action_policy.sales_navigator_actions, false);

const expectedCompatibilityCommands = {
  install: 'START-HERE-TALENTTRACK.cmd',
  start: 'START-TALENTTRACK.cmd',
  check: 'CHECK-TALENTTRACK.cmd',
  diagnose: 'DIAGNOSE-TALENTTRACK.cmd',
  rollback: 'ROLLBACK-TALENTTRACK.cmd',
  review: 'OPEN-TALENTTRACK-REVIEW.cmd',
};
for (const [key, file] of Object.entries(expectedCompatibilityCommands)) {
  assert.equal(release.canonical_commands[key], file);
  const content = fs.readFileSync(path.join(workerRoot, file), 'utf8');
  assert(content.includes('ACQUISITION-V4') || content.includes('ACQUISITION-REVIEW'), `${file} must remain a compatibility wrapper during the pilot`);
  assert(content.includes('exit /b %ERRORLEVEL%'), `${file} must preserve the delegated exit code`);
}

const expectedPostgresCommands = {
  enable_local_postgres: 'ENABLE-TALENTTRACK-POSTGRES.cmd',
  check_local_postgres: 'CHECK-TALENTTRACK-POSTGRES.cmd',
  backup_local_postgres: 'BACKUP-TALENTTRACK-POSTGRES.cmd',
  restore_local_postgres: 'RESTORE-TALENTTRACK-POSTGRES.cmd',
};
for (const [key, file] of Object.entries(expectedPostgresCommands)) {
  assert.equal(release.canonical_commands[key], file);
  const content = fs.readFileSync(path.join(workerRoot, file), 'utf8');
  assert(content.includes('exit /b %EXIT_CODE%'), `${file} must preserve its PostgreSQL operation exit code`);
}

for (const marker of [
  '# TalentTrack Pilot',
  'TalentTrack Pilot 1.0.0',
  'Runtime: `0.3.1`',
  'START-HERE-TALENTTRACK.cmd',
  'CHECK-TALENTTRACK.cmd',
  'ROLLBACK-TALENTTRACK.cmd',
  'ENABLE-TALENTTRACK-POSTGRES.cmd',
  'JSON rollback shadow',
  'The internal Python package remains named `acquisition_v4`',
  'captured records',
  'deduplication fingerprints',
  'No proposal, application, message, InMail, connection request, follow, reaction, comment or email action',
]) assert(readme.includes(marker), `runtime README missing marker: ${marker}`);

for (const marker of [
  '# TalentTrack Pilot Release Baseline',
  'authoritative operating and release-status reference',
  '`live-validation`',
  '`active`',
  '`on-hold`',
  '`superseded-reference`',
  'Optional local PostgreSQL capture store',
  'no automatic fallback can create a divergent second history',
  'Closed PRs #252 and #253 are obsolete implementations',
  'keep `%LOCALAPPDATA%\\Codistan\\Acquisition` unchanged',
  'restore the previous application package',
  '`main` must not be updated merely because code checks pass',
]) assert(baseline.includes(marker), `release baseline missing marker: ${marker}`);

for (const marker of [
  '# TalentTrack Local PostgreSQL',
  'binds only to `127.0.0.1`',
  'fail-closed',
  'JSON rollback shadow',
  'BACKUP-TALENTTRACK-POSTGRES.cmd',
  'RESTORE-TALENTTRACK-POSTGRES.cmd',
  'RESTORE TALENTTRACK',
  'does not replace or modify Prospect Desk',
]) assert(postgresGuide.includes(marker), `local PostgreSQL guide missing marker: ${marker}`);

for (const marker of [
  'Start TalentTrack Pilot.lnk',
  'Check TalentTrack Pilot.lnk',
  'Open TalentTrack Review.lnk',
  'TalentTrack Pilot Diagnostics.lnk',
  'Rollback TalentTrack Pilot.lnk',
  'Codistan TalentTrack Pilot.lnk',
  'Enable TalentTrack Local PostgreSQL.lnk',
  'Check TalentTrack Local PostgreSQL.lnk',
  'Backup TalentTrack Local PostgreSQL.lnk',
  'Restore TalentTrack Local PostgreSQL.lnk',
  '$legacyShortcutNames',
  'START-TALENTTRACK.cmd',
  'RELEASE.json',
  'requirements.txt',
  '$expectedBackend',
  'State and captured records preserved at',
  'app-current',
  'app-previous',
]) assert(installer.includes(marker), `installer missing release-baseline marker: ${marker}`);

const combined = `${JSON.stringify(release)}\n${readme}\n${baseline}\n${postgresGuide}\n${installer}`.toLowerCase();
for (const prohibited of [
  'automatic_sending":true',
  'upwork_submission":true',
  'linkedin_messaging":true',
  'sales_navigator_actions":true',
  'delete captured records',
  'delete deduplication',
  'docker compose down -v',
  'docker volume rm',
  'captcha bypass',
  'navigator.webdriver',
]) assert(!combined.includes(prohibited), `release baseline contains prohibited marker: ${prohibited}`);

console.log('TalentTrack Pilot release baseline contract passed.');
