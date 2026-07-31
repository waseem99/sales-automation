import assert from 'node:assert/strict';
import {
  createDeletionPlan,
  EXTENSION_PERMISSION_REVIEWS,
  permissionReview,
  privacyAccessFor,
  retentionDecision,
  RETENTION_RULES,
} from './index.js';

for (const review of Object.values(EXTENSION_PERMISSION_REVIEWS)) {
  assert.deepEqual(review.permissions.map((item) => item.permission).sort(), ['alarms', 'scripting', 'storage', 'tabs']);
  assert.equal(review.permissions.every((item) => item.required), true);
  assert.equal(review.prohibitedPermissions.includes('activeTab'), true);
  assert.equal(review.prohibitedPermissions.includes('cookies'), true);
  assert.equal(review.cookiesCaptured, false);
  assert.equal(review.privateMessagesCaptured, false);
  assert.equal(review.remoteCodeAllowed, false);
  assert.equal(review.externalActionAutomated, false);
}
assert.equal(permissionReview('linkedin_sales_navigator').extensionVersion, '1.6.1');
assert.equal(permissionReview('upwork').extensionVersion, '1.1.1');
assert.equal(RETENTION_RULES.length, 6);

const admin = privacyAccessFor({actor: 'waseem@codistan.org', scopeKind: 'all', canRunGlobalOperations: true});
assert.equal(admin.diagnostics, 'full_redacted');
assert.equal(admin.canExportRedactedDiagnostics, true);
assert.equal(admin.canPlanDeletion, true);
assert.equal(admin.canExecuteDeletion, false);
assert.equal(admin.rawSecretsVisible, false);
const team = privacyAccessFor({actor: 'team@codistan.org', scopeKind: 'team', canRunGlobalOperations: false});
assert.equal(team.diagnostics, 'scoped_summary');
assert.equal(team.canExportRedactedDiagnostics, false);
const seller = privacyAccessFor({actor: 'seller@codistan.org', scopeKind: 'own', canRunGlobalOperations: false});
assert.equal(seller.diagnostics, 'own_summary');
assert.equal(seller.canPlanDeletion, false);

const now = '2026-07-31T15:00:00.000Z';
assert.equal(retentionDecision({
  class: 'unresolved_outbox', createdAt: '2025-01-01T00:00:00.000Z', unresolved: true,
}, now).action, 'retain');
assert.equal(retentionDecision({
  class: 'parser_diagnostics', createdAt: '2026-07-20T00:00:00.000Z',
}, now).action, 'retain');
assert.equal(retentionDecision({
  class: 'parser_diagnostics', createdAt: '2026-01-01T00:00:00.000Z',
}, now).action, 'manual_deletion_eligible');
assert.equal(retentionDecision({
  class: 'source_evidence', createdAt: '2024-01-01T00:00:00.000Z', terminalAt: '2025-01-01T00:00:00.000Z', legalHold: true,
}, now).action, 'retain');

assert.throws(() => createDeletionPlan({
  actor: 'seller@codistan.org', canRunGlobalOperations: false,
  stateRoot: 'C:/Users/test/AppData/Local/Codistan/Acquisition', targets: [],
}), /Global operations permission/);
const plan = createDeletionPlan({
  actor: 'admin',
  canRunGlobalOperations: true,
  stateRoot: 'C:\\Users\\test\\AppData\\Local\\Codistan\\Acquisition',
  requestedAt: now,
  targets: [
    'C:/Users/test/AppData/Local/Codistan/Acquisition',
    'C:/Users/test/AppData/Local/Codistan/Acquisition/diagnostics/expired.json',
    'C:/Users/test/AppData/Local/Codistan/Acquisition/sync/outbox/linkedin.json',
    'C:/Users/test/AppData/Local/Codistan/Acquisition/rollback/state.json',
    'C:/outside/file.json',
  ],
});
assert.deepEqual(plan.targets, ['C:/Users/test/AppData/Local/Codistan/Acquisition/diagnostics/expired.json']);
assert.equal(plan.rejectedTargets.length, 4);
assert.equal(plan.executeAutomatically, false);
assert.equal(plan.preserveUnresolvedOutbox, true);
assert.equal(plan.preserveRollbackState, true);
assert.equal(plan.planHash.length, 64);
console.log('Extension permission, diagnostics access, retention and safe deletion-plan tests passed.');
