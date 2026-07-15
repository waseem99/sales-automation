import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const leadSignals = readFileSync(new URL('../api/lead-signals.ts', import.meta.url), 'utf8');
const portfolio = readFileSync(new URL('../vercel/portfolio-catalog-runtime.ts', import.meta.url), 'utf8');
const operations = readFileSync(new URL('../vercel/operations-runtime.ts', import.meta.url), 'utf8');
const dashboard = readFileSync(new URL('../api/dashboard.ts', import.meta.url), 'utf8');

const staticRuntimeImport = /import\s+(?!type\b)[\s\S]*?from\s+['"](?:@sales-automation\/|\.\.\/vercel\/(?:linkedin-warm-signal-engine|upwork-saved-search-engine)|\.\/approved-portfolio)/m;

assert.equal(staticRuntimeImport.test(leadSignals), false, 'Lead Signals must not statically import runtime ESM packages or engines.');
assert.equal(staticRuntimeImport.test(portfolio), false, 'Portfolio runtime must not statically import Neon or starter-data runtime modules.');
assert.equal(staticRuntimeImport.test(operations), false, 'Operations runtime must not statically import Neon runtime modules.');

assert.equal(leadSignals.includes("import('@sales-automation/neon-state')"), true);
assert.equal(leadSignals.includes("import('../vercel/linkedin-warm-signal-engine.js')"), true);
assert.equal(leadSignals.includes("import('../vercel/upwork-saved-search-engine.js')"), true);
assert.equal(portfolio.includes("import('@sales-automation/neon-state/portfolio-catalog')"), true);
assert.equal(portfolio.includes("import('./approved-portfolio.js')"), true);
assert.equal(operations.includes("import('@sales-automation/neon-state')"), true);
assert.equal(operations.includes("import('@sales-automation/neon-state/source-controls')"), true);

const operationsRoute = dashboard.indexOf("pathname === '/operations'");
const managedCatalogLoad = dashboard.indexOf("phase = 'load_managed_portfolio_catalog'");
const legacyRuntimeLoad = dashboard.indexOf("import('./dashboard-runtime.js')");
assert.ok(operationsRoute >= 0, 'Dashboard must route Operations explicitly.');
assert.ok(operationsRoute < managedCatalogLoad, 'Operations must not load the managed portfolio catalog first.');
assert.ok(operationsRoute < legacyRuntimeLoad, 'Operations must not load the legacy dashboard runtime first.');

console.log('Lead Signals, Portfolio and Operations keep ESM dependencies behind isolated dynamic boundaries');
