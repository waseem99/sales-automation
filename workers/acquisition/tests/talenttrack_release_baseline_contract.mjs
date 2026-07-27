import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve('../..');
const workerRoot = path.join(repoRoot, 'workers/acquisition');
const release = JSON.parse(fs.readFileSync(path.join(workerRoot, 'RELEASE.json'), 'utf8'));
const readme = fs.readFileSync(path.join(workerRoot, 'README.md'), 'utf8');
const baseline = fs.readFileSync(path.join(repoRoot, 'docs/TALENTTRACK_RELEASE_BASELINE.md'), 'utf8');
const installer = fs.readFileSync(path.join(workerRoot, 'scripts/windows/install-acquisition-v4.ps1'), 'utf8');

assert.equal(release.product, 'TalentTrack Pilot');
assert.equal(release.product_version, '1.0.0');
assert.equal(release.release_status, 'live_validation');
assert.equal(release.state_root, '%LOCALAPPDATA%\\Codistan\\Acquisition');
assert.equal(release.internal_runtime_package, 'acquisition_v4');
assert.equal(release.legacy_compatibility.enabled, true);
assert.equal(release.external_action_policy.automatic_sending, false);
assert.equal(release.external_action_policy.upwork_submission, false);
assert.equal(release.external_action_policy.linkedin_messaging, false);
assert.equal(release.external_action_policy.sales_navigator_actions, false);

const expectedCommands = {
  install: 'START-HERE-TALENTTRACK.cmd',
  start: 'START-TALENTTRACK.cmd',
  check: 'CHECK-TALENTTRACK.cmd',
  diagnose: 'DIAGNOSE-TALENTTRACK.cmd',
  rollback: 'ROLLBACK-TALENTTRACK.cmd',
  review: 'OPEN-TALENTTRACK-REVIEW.cmd',
};
for (const [key, file] of Object.entries(expectedCommands)) {
  assert.equal(release.canonical_commands[key], file);
  const content = fs.readFileSync(path.join(workerRoot, file), 'utf8');
  assert(content.includes('ACQUISITION-V4') || content.includes('ACQUISITION-REVIEW'), `${file} must remain a compatibility wrapper during the pilot`);
  assert(content.includes('exit /b %ERRORLEVEL%'), `${file} must preserve the delegated exit code`);
}

for (const marker of [
  '# TalentTrack Pilot',
  'TalentTrack Pilot 1.0.0',
  'START-HERE-TALENTTRACK.cmd',
  'CHECK-TALENTTRACK.cmd',
  'ROLLBACK-TALENTTRACK.cmd',
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
  'Closed PRs #252 and #253 are obsolete implementations',
  'keep `%LOCALAPPDATA%\\Codistan\\Acquisition` unchanged',
  'restore the previous application package',
  '`main` must not be updated merely because code checks pass',
]) assert(baseline.includes(marker), `release baseline missing marker: ${marker}`);

for (const marker of [
  'Start TalentTrack Pilot.lnk',
  'Check TalentTrack Pilot.lnk',
  'Open TalentTrack Review.lnk',
  'TalentTrack Pilot Diagnostics.lnk',
  'Rollback TalentTrack Pilot.lnk',
  'Codistan TalentTrack Pilot.lnk',
  '$legacyShortcutNames',
  'START-TALENTTRACK.cmd',
  'RELEASE.json',
  'State and captured records preserved at',
  'app-current',
  'app-previous',
]) assert(installer.includes(marker), `installer missing release-baseline marker: ${marker}`);

const combined = `${JSON.stringify(release)}\n${readme}\n${baseline}\n${installer}`.toLowerCase();
for (const prohibited of [
  'automatic_sending":true',
  'upwork_submission":true',
  'linkedin_messaging":true',
  'sales_navigator_actions":true',
  'delete captured records',
  'delete deduplication',
  'captcha bypass',
  'navigator.webdriver',
]) assert(!combined.includes(prohibited), `release baseline contains prohibited marker: ${prohibited}`);

console.log('TalentTrack Pilot release baseline contract passed.');
