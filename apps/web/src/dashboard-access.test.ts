import assert from 'node:assert/strict';
import type { Lead } from '@sales-automation/shared';
import { canAccessLead, resolveDashboardAccess } from './dashboard-access.js';

const lead = (owner?: string): Pick<Lead, 'owner'> => ({ owner });

const admin = resolveDashboardAccess('admin');
assert.equal(admin.scopeKind, 'all');
assert.equal(admin.canRunGlobalOperations, true);
assert.equal(canAccessLead(admin, lead(undefined)), true);

const waseem = resolveDashboardAccess('waseem@codistan.org');
assert.equal(waseem.scopeKind, 'all');
assert.equal(waseem.canRunGlobalOperations, true);

const talha = resolveDashboardAccess('talha.bashir@codistan.org');
assert.equal(talha.scopeKind, 'team');
assert.equal(canAccessLead(talha, lead('talha.bashir@codistan.org')), true);
assert.equal(canAccessLead(talha, lead('danishkhalid@codistan.org')), true);
assert.equal(canAccessLead(talha, lead('Hiba')), true);
assert.equal(canAccessLead(talha, lead('Bilal — Talha team')), true);
assert.equal(canAccessLead(talha, lead('jawad.jutt@codistan.org')), false);
assert.equal(canAccessLead(talha, lead(undefined)), false);

const jawad = resolveDashboardAccess('jawad.jutt@codistan.org');
assert.equal(jawad.scopeKind, 'own');
assert.equal(canAccessLead(jawad, lead('jawad.jutt@codistan.org')), true);
assert.equal(canAccessLead(jawad, lead('Jawad Jutt')), true);
assert.equal(canAccessLead(jawad, lead('moiz.khalid@codistan.org')), false);
assert.equal(jawad.canRunGlobalOperations, false);
assert.equal(jawad.canAssignOwners, false);

console.log('dashboard access scope tests passed');
