import assert from 'node:assert/strict';
import { assertPermission, can, checkPermission, isUserRole } from './index.js';

assert.equal(can('admin', 'manage_users'), true);
assert.equal(can('founder', 'manage_compliance_rules'), true);
assert.equal(can('bd_manager', 'ingest_leads'), true);
assert.equal(can('reviewer', 'update_pipeline_status'), true);
assert.equal(can('reviewer', 'assign_owner'), false);
assert.equal(can('read_only', 'view_opportunities'), true);
assert.equal(can('read_only', 'ingest_leads'), false);

const denied = checkPermission('read_only', 'update_pipeline_status');
assert.equal(denied.allowed, false);
assert.equal(denied.role, 'read_only');
assert.equal(denied.permission, 'update_pipeline_status');

assert.doesNotThrow(() => assertPermission('bd_manager', 'assign_owner'));
assert.throws(() => assertPermission('read_only', 'add_notes'), /Forbidden/);
assert.equal(isUserRole('admin'), true);
assert.equal(isUserRole('unknown'), false);

console.log('Access control tests passed.');
