import assert from 'node:assert/strict';
import { requireDatabaseUrl } from './index.js';

assert.equal(requireDatabaseUrl(' postgresql://example '), 'postgresql://example');
assert.throws(() => requireDatabaseUrl(undefined), /DATABASE_URL is required/);
assert.throws(() => requireDatabaseUrl('   '), /DATABASE_URL is required/);

console.log('neon-state tests passed');
