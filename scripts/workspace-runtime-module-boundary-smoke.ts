import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const runtimeSource = readFileSync(new URL('../vercel/workspace-dashboard-runtime.ts', import.meta.url), 'utf8');
const pageSource = readFileSync(new URL('../vercel/workspace-pages.ts', import.meta.url), 'utf8');
const leadSignals = readFileSync(new URL('../api/lead-signals.ts', import.meta.url), 'utf8');
const linkedInEngine = readFileSync(new URL('../vercel/linkedin-warm-signal-engine.ts', import.meta.url), 'utf8');
const upworkEngine = readFileSync(new URL('../vercel/upwork-saved-search-engine.ts', import.meta.url), 'utf8');
const portfolio = readFileSync(new URL('../vercel/portfolio-catalog-runtime.ts', import.meta.url), 'utf8');
const operations = readFileSync(new URL('../vercel/operations-runtime.ts', import.meta.url), 'utf8');
const dashboard = readFileSync(new URL('../api/dashboard.ts', import.meta.url), 'utf8');
const staticSalesAutomationImport = /import\s+(?!type\b)[\s\S]*?from\s+['"]@sales-automation\//m;

for (const [label, source] of [
  ['workspace runtime', runtimeSource],
  ['workspace page model', pageSource],
  ['lead signals API', leadSignals],
  ['LinkedIn signal engine', linkedInEngine],
  ['Upwork signal engine', upworkEngine],
  ['portfolio runtime', portfolio],
  ['operations runtime', operations],
] as const) {
  assert.equal(
    staticSalesAutomationImport.test(source),
    false,
    `${label} must keep runtime ESM packages behind dynamic imports`,
  );
}

assert.equal(runtimeSource.includes("import('@sales-automation/neon-state')"), true);
assert.equal(runtimeSource.includes("import('@sales-automation/prospect-discovery')"), true);
assert.equal(runtimeSource.includes("import('@sales-automation/storage')"), true);
assert.equal(runtimeSource.includes("import('@sales-automation/web/prospect-handler')"), true);
assert.equal(runtimeSource.includes("import('@sales-automation/neon-state/portfolio-catalog')"), true);
assert.equal(pageSource.includes('normalizeWorkspacePageQuery'), true);
assert.equal(pageSource.includes('normalizeProspectPageQuery'), false);

assert.equal(leadSignals.includes("import('@sales-automation/neon-state')"), true);
assert.equal(leadSignals.includes("import('../vercel/linkedin-warm-signal-engine.js')"), true);
assert.equal(leadSignals.includes("import('../vercel/upwork-saved-search-engine.js')"), true);
assert.equal(linkedInEngine.includes("import('@sales-automation/evaluator')"), true);
assert.equal(linkedInEngine.includes("import('@sales-automation/fixtures')"), true);
assert.equal(linkedInEngine.includes("import('@sales-automation/prospect-discovery')"), true);
assert.equal(linkedInEngine.includes("import('@sales-automation/web')"), true);
assert.equal(upworkEngine.includes("import('@sales-automation/evaluator')"), true);
assert.equal(upworkEngine.includes("import('@sales-automation/fixtures')"), true);
assert.equal(upworkEngine.includes("import('@sales-automation/ingestion')"), true);
assert.equal(upworkEngine.includes("import('@sales-automation/parsers')"), true);
assert.equal(upworkEngine.includes("import('@sales-automation/prospect-discovery')"), true);
assert.equal(upworkEngine.includes("import('@sales-automation/web')"), true);
assert.equal(portfolio.includes("import('@sales-automation/neon-state/portfolio-catalog')"), true);
assert.equal(portfolio.includes("import('./approved-portfolio.js')"), true);
assert.equal(operations.includes("import('@sales-automation/neon-state')"), true);
assert.equal(operations.includes("import('@sales-automation/neon-state/source-controls')"), true);

const operationsRoute = dashboard.indexOf("pathname === '/operations'");
const managedCatalogLoad = dashboard.indexOf("phase = 'load_managed_portfolio_catalog'");
const legacyRuntimeLoad = dashboard.indexOf("import('./dashboard-runtime.js')");
assert.ok(operationsRoute >= 0);
assert.ok(operationsRoute < managedCatalogLoad);
assert.ok(operationsRoute < legacyRuntimeLoad);

console.log('Workspace, Signal Intake engines, Portfolio and Operations keep ESM package access behind isolated dynamic boundaries');
