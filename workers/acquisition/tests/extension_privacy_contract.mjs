import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  EXTENSION_PERMISSION_REVIEWS,
  createDeletionPlan,
  privacyAccessFor,
  retentionDecision,
} from '../../../packages/privacy-governance/src/index.ts';

const repoRoot = path.resolve(process.cwd());
const extensionRoot = path.join(repoRoot, 'workers/acquisition/extensions');
const linkedinRoot = path.join(extensionRoot, 'linkedin');
const upworkRoot = path.join(extensionRoot, 'upwork');
const linkedinManifest = JSON.parse(fs.readFileSync(path.join(linkedinRoot, 'manifest.json'), 'utf8'));
const upworkManifest = JSON.parse(fs.readFileSync(path.join(upworkRoot, 'manifest.json'), 'utf8'));
const privacyApi = fs.readFileSync(path.join(repoRoot, 'api/privacy-review.ts'), 'utf8');
const reviewDocument = fs.readFileSync(path.join(repoRoot, 'docs/sales-automation/EXTENSION-PERMISSION-PRIVACY-REVIEW.md'), 'utf8');

assert.deepEqual(linkedinManifest.permissions, ['tabs', 'storage', 'scripting', 'alarms']);
assert.deepEqual(upworkManifest.permissions, ['tabs', 'storage', 'alarms', 'scripting']);
assert.equal(linkedinManifest.version, '1.6.2');
assert.equal(upworkManifest.version, '1.1.2');
assert.deepEqual(linkedinManifest.host_permissions, [
  'https://www.linkedin.com/*',
  'https://sales.linkedin.com/*',
  'http://127.0.0.1:8775/*',
  'http://127.0.0.1:8785/*',
  'http://127.0.0.1:8795/*',
]);
assert.deepEqual(upworkManifest.host_permissions, [
  'https://www.upwork.com/*',
  'http://127.0.0.1:8765/*',
  'http://127.0.0.1:8795/*',
]);

const prohibitedPermissions = [
  'activeTab', 'cookies', 'webRequest', 'webRequestBlocking', 'history', 'downloads',
  'nativeMessaging', 'clipboardRead', 'clipboardWrite', 'declarativeNetRequest', '<all_urls>',
];
for (const manifest of [linkedinManifest, upworkManifest]) {
  for (const permission of prohibitedPermissions) {
    assert(!manifest.permissions.includes(permission), `Manifest contains prohibited permission ${permission}`);
    assert(!manifest.host_permissions.includes(permission), `Manifest contains prohibited host permission ${permission}`);
  }
}

for (const review of Object.values(EXTENSION_PERMISSION_REVIEWS)) {
  assert.equal(review.permissions.length, 4);
  assert.equal(review.permissions.every((permission) => permission.usageEvidence.length > 0), true);
  assert.equal(review.cookiesCaptured, false);
  assert.equal(review.privateMessagesCaptured, false);
  assert.equal(review.remoteCodeAllowed, false);
  assert.equal(review.externalActionAutomated, false);
}

const extensionFiles = [
  ...walk(linkedinRoot),
  ...walk(upworkRoot),
].filter((file) => /\.(?:js|html|json)$/i.test(file));
const sourceByFile = new Map(extensionFiles.map((file) => [file, fs.readFileSync(file, 'utf8')]));
const combined = [...sourceByFile.values()].join('\n').toLowerCase();

for (const marker of [
  'chrome.cookies',
  'document.cookie',
  'localstorage.getitem',
  'sessionstorage.getitem',
  'chrome.history',
  'chrome.webrequest',
  'chrome.downloads',
  'chrome.nativemessaging',
  'navigator.webdriver',
  'external_action_performed: true',
  'external_action_automated: true',
  'sendlinkedinmessage(',
  'connectrequest(',
  'submitupworkproposal(',
]) assert(!combined.includes(marker), `Extension tree contains prohibited privacy/action marker: ${marker}`);

for (const [file, source] of sourceByFile) {
  if (!file.endsWith('.js') && !file.endsWith('.html')) continue;
  assert(!/\beval\s*\(/i.test(source), `${relative(file)} uses eval`);
  assert(!/\bnew\s+Function\s*\(/i.test(source), `${relative(file)} uses new Function`);
  assert(!/importScripts\s*\(\s*['"]https?:\/\//i.test(source), `${relative(file)} imports remote code`);
  assert(!/<script[^>]+src\s*=\s*['"]https?:\/\//i.test(source), `${relative(file)} loads a remote script`);
  assert(!/\bimport\s*\(\s*['"]https?:\/\//i.test(source), `${relative(file)} imports a remote module`);
  assert(!/WebAssembly\.(?:compile|instantiate)\s*\(/i.test(source), `${relative(file)} loads executable WebAssembly`);
}

const captureFiles = extensionFiles.filter((file) => /(?:content|sales-nav|background|evidence|scroll|resolver|adapter|detail|automation-trigger)\.js$/i.test(file));
for (const file of captureFiles) {
  if (file.endsWith('parser-hardening.js')) continue;
  const source = fs.readFileSync(file, 'utf8').toLowerCase();
  for (const marker of ['private_message_body', 'conversation_body', '/messaging/', 'message_thread_content']) {
    assert(!source.includes(marker), `${relative(file)} contains a private-message capture marker: ${marker}`);
  }
}

for (const marker of [
  'resolveDashboardAccess',
  'privacyAccessFor',
  'x-codistan-actor',
  'full_redacted',
  'executionAvailable: false',
  'rawSecretsVisible: false',
  'privateMessagesVisible: false',
  'externalActionAutomated: false',
]) assert(privacyApi.includes(marker), `Privacy API missing ${marker}`);

const admin = privacyAccessFor({actor: 'admin', scopeKind: 'all', canRunGlobalOperations: true});
const seller = privacyAccessFor({actor: 'seller@codistan.org', scopeKind: 'own', canRunGlobalOperations: false});
assert.equal(admin.diagnostics, 'full_redacted');
assert.equal(admin.canPlanDeletion, true);
assert.equal(admin.canExecuteDeletion, false);
assert.equal(seller.diagnostics, 'own_summary');
assert.equal(seller.canExportRedactedDiagnostics, false);
assert.equal(seller.rawSecretsVisible, false);

assert.equal(retentionDecision({
  class: 'unresolved_outbox', createdAt: '2025-01-01T00:00:00.000Z', unresolved: true,
}, '2026-07-31T15:00:00.000Z').action, 'retain');
const plan = createDeletionPlan({
  actor: 'admin',
  canRunGlobalOperations: true,
  stateRoot: 'C:/Users/test/AppData/Local/Codistan/Acquisition',
  requestedAt: '2026-07-31T15:00:00.000Z',
  targets: [
    'C:/Users/test/AppData/Local/Codistan/Acquisition',
    'C:/Users/test/AppData/Local/Codistan/Acquisition/diagnostics/expired.json',
    'C:/Users/test/AppData/Local/Codistan/Acquisition/sync/dead-letter/linkedin.json',
  ],
});
assert.deepEqual(plan.targets, ['C:/Users/test/AppData/Local/Codistan/Acquisition/diagnostics/expired.json']);
assert.equal(plan.rejectedTargets.length, 2);
assert.equal(plan.executeAutomatically, false);
assert.equal(plan.retainAuditTombstones, true);

for (const marker of [
  'activeTab` | Removed',
  'Remote scripts',
  'cookies or cookie headers',
  'private-message or conversation content',
  'Pending/retrying/dead-letter/conflicted outbox',
  '%LOCALAPPDATA%\\Codistan\\Acquisition',
  'Automatic external actions',
]) assert(reviewDocument.includes(marker), `Privacy review document missing ${marker}`);

console.log('Extension permission, private-data, remote-code, retention and diagnostic-access contract passed.');

function walk(directory) {
  return fs.readdirSync(directory, {withFileTypes: true}).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function relative(file) {
  return path.relative(repoRoot, file).replaceAll('\\', '/');
}
