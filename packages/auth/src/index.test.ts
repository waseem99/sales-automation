import assert from 'node:assert/strict';
import { formatActor, getHeaderValue, normalizeHeaders, resolveSession, StaticSessionAdapter } from './index.js';

const adapter = new StaticSessionAdapter({
  'founder-token': {
    id: 'user-founder',
    email: 'founder@codistan.org',
    name: 'Founder',
    role: 'founder',
    isActive: true,
  },
  'bd-token': {
    id: 'user-bd',
    email: 'bd@codistan.org',
    role: 'bd_manager',
    isActive: true,
  },
  'inactive-token': {
    id: 'user-inactive',
    email: 'inactive@codistan.org',
    role: 'admin',
    isActive: false,
  },
});

const noAdapter = resolveSession({}, {});
assert.equal(noAdapter.authenticated, false);
assert.equal(noAdapter.role, 'read_only');
assert.equal(noAdapter.actor, 'anonymous');
assert.ok(noAdapter.reason.includes('safe fallback'));

const founder = resolveSession({ headers: { authorization: 'Bearer founder-token' } }, { adapter });
assert.equal(founder.authenticated, true);
assert.equal(founder.role, 'founder');
assert.equal(founder.actor, 'founder@codistan.org');

const bd = resolveSession({ headers: { 'x-sales-automation-session': 'bd-token' } }, { adapter });
assert.equal(bd.authenticated, true);
assert.equal(bd.role, 'bd_manager');
assert.equal(bd.actor, 'bd@codistan.org');

const missing = resolveSession({ headers: { authorization: 'Bearer missing-token' } }, { adapter });
assert.equal(missing.authenticated, false);
assert.equal(missing.role, 'read_only');
assert.equal(missing.actor, 'anonymous');

const inactive = resolveSession({ headers: { authorization: 'Bearer inactive-token' } }, { adapter, fallbackActor: 'inactive-fallback' });
assert.equal(inactive.authenticated, false);
assert.equal(inactive.role, 'read_only');
assert.equal(inactive.actor, 'inactive-fallback');
assert.ok(inactive.reason.includes('inactive'));

assert.equal(formatActor({ id: 'user-id', name: 'Name Only', role: 'reviewer', isActive: true }), 'Name Only');
assert.equal(formatActor({ id: 'user-id', role: 'reviewer', isActive: true }), 'user-id');
assert.deepEqual(normalizeHeaders({ Authorization: 'Bearer token', multi: ['first', 'second'] }), { authorization: 'Bearer token', multi: 'first' });
assert.equal(getHeaderValue({ Authorization: 'Bearer token' }, 'authorization'), 'Bearer token');

console.log('Auth session resolution tests passed.');
