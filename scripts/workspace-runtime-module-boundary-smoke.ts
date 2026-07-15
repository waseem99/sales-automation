import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../vercel/workspace-dashboard-runtime.ts', import.meta.url), 'utf8');

assert.equal(source.includes("from '@sales-automation/fixtures'"), false);
assert.equal(source.includes("import('@sales-automation/neon-state/portfolio-catalog')"), true);
assert.equal(source.includes('portfolioItems,'), true);

console.log('Workspace runtime uses an ESM-safe managed portfolio boundary');
