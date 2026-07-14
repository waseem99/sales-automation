import assert from 'node:assert/strict';
import type { Lead } from '@sales-automation/shared';
import { canAccessLead, resolveDashboardAccess } from './dashboard-access.js';
import { applyDashboardSummary, repairEmbeddedClientScript } from './paginated-prospects-page.js';

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
assert.equal(canAccessLead(talha, lead('hibasohail@codistan.org')), true);
assert.equal(canAccessLead(talha, lead('Hiba')), true);
assert.equal(canAccessLead(talha, lead('bilalahmed@codistan.org')), true);
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

const hiba = resolveDashboardAccess('hibasohail@codistan.org');
assert.equal(hiba.displayName, 'Hiba Sohail');
assert.equal(hiba.scopeKind, 'own');
assert.equal(canAccessLead(hiba, lead('hibasohail@codistan.org')), true);
assert.equal(canAccessLead(hiba, lead('Hiba')), true);
assert.equal(canAccessLead(hiba, lead('bilalahmed@codistan.org')), false);

const bilal = resolveDashboardAccess('bilalahmed@codistan.org');
assert.equal(bilal.displayName, 'Bilal Ahmed');
assert.equal(bilal.scopeKind, 'own');
assert.equal(canAccessLead(bilal, lead('bilalahmed@codistan.org')), true);
assert.equal(canAccessLead(bilal, lead('Bilal — Talha team')), true);
assert.equal(canAccessLead(bilal, lead('hibasohail@codistan.org')), false);

const brokenClientStatement = "payload.body='Team member: '+performedBy+'\n'+String(payload.body||'');";
assert.throws(() => new Function(brokenClientStatement), SyntaxError);
const repairedClientStatement = repairEmbeddedClientScript(brokenClientStatement);
assert.equal(repairedClientStatement, "payload.body='Team member: '+performedBy+'\\n'+String(payload.body||'');");
assert.doesNotThrow(() => new Function(repairedClientStatement));

const summaryHtml = applyDashboardSummary(
  '<section><article><span>Total prospects</span><strong>25</strong></article><article><span>Live opportunities</span><strong>3</strong></article></section><div class="sidebar-card"><span>BD work queue</span><strong>25 unassigned</strong><small>0 follow-ups due · 25 feedback pending</small></div>',
  { total: 142, live: 18, contacted: 11, replied: 6, followUpsDue: 4, unassigned: 97, won: 2, feedbackPending: 130 },
);
assert.match(summaryHtml, /Total prospects<\/span><strong>142<\/strong>/);
assert.match(summaryHtml, /Live opportunities<\/span><strong>18<\/strong>/);
assert.match(summaryHtml, /97 unassigned<\/strong><small>4 follow-ups due · 130 feedback pending/);

console.log('dashboard access scope, aggregate summary and embedded client script tests passed');
