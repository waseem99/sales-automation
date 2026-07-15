import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const runtimeSource = readFileSync(new URL('../vercel/workspace-dashboard-runtime.ts', import.meta.url), 'utf8');
const pageSource = readFileSync(new URL('../vercel/workspace-pages.ts', import.meta.url), 'utf8');
const leadSignals = readFileSync(new URL('../api/lead-signals.ts', import.meta.url), 'utf8');
const portfolio = readFileSync(new URL('../vercel/portfolio-catalog-runtime.ts', import.meta.url), 'utf8');
const operations = readFileSync(new URL('../vercel/operations-runtime.ts', import.meta.url), 'utf8');
const dashboard = readFileSync(new URL('../api/dashboard.ts', import.meta.url), 'utf8');
const staticSalesAutomationImport = /import\s+(?!type\b)[\s\S]*?from\s+['"]@sales-automation\//m;

assert.equal(staticSalesAutomationImport.test(runtimeSource), false);
assert.equal(staticSalesAutomationImport.test(pageSource), false);
assert.equal(staticSalesAutomationImport.test(leadSignals), false);
assert.equal(staticSalesAutomationImport.test(portfolio), false);
assert.equal(staticSalesAutomationImport.test(operations), false);

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
assert.equal(leadSignals.includes("from '../vercel/linkedin-warm-signal-engine.js'"), false);
assert.equal(leadSignals.includes("from '../vercel/upwork-saved-search-engine.js'"), false);
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

console.log('Workspace, Lead Signals, Portfolio and Operations keep ESM package access behind isolated dynamic boundaries');
