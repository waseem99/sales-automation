import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const runtimeSource = readFileSync(new URL('../vercel/workspace-dashboard-runtime.ts', import.meta.url), 'utf8');
const pageSource = readFileSync(new URL('../vercel/workspace-pages.ts', import.meta.url), 'utf8');
const modelSource = readFileSync(new URL('../vercel/workspace-page-model.ts', import.meta.url), 'utf8');
const staticSalesAutomationImport = /import\s+(?!type\b)[\s\S]*?from\s+['"]@sales-automation\//m;

assert.equal(staticSalesAutomationImport.test(runtimeSource), false);
assert.equal(staticSalesAutomationImport.test(pageSource), false);
assert.equal(staticSalesAutomationImport.test(modelSource), false);
assert.equal(runtimeSource.includes("import('@sales-automation/neon-state')"), true);
assert.equal(runtimeSource.includes("import('@sales-automation/prospect-discovery')"), true);
assert.equal(runtimeSource.includes("import('@sales-automation/storage')"), true);
assert.equal(runtimeSource.includes("import('@sales-automation/web/prospect-handler')"), true);
assert.equal(runtimeSource.includes("import('@sales-automation/neon-state/portfolio-catalog')"), true);
assert.equal(pageSource.includes("from './workspace-page-model.js'"), true);
assert.equal(modelSource.includes('normalizeWorkspacePageQuery'), true);
assert.equal(modelSource.includes('normalizeProspectPageQuery'), false);

console.log('Workspace runtime, shared shell and page model keep ESM package access behind dynamic boundaries');
