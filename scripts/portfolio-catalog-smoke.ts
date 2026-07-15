import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { approvedStarterPortfolioItems } from '../vercel/approved-portfolio.js';

const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')) as {
  rewrites?: Array<{ source: string; destination: string }>;
};
const dashboard = readFileSync(new URL('../api/dashboard.ts', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../vercel/portfolio-catalog-runtime.ts', import.meta.url), 'utf8');
const shell = readFileSync(new URL('../vercel/workspace-pages.ts', import.meta.url), 'utf8');
const catalog = readFileSync(new URL('../packages/neon-state/src/portfolio-catalog.ts', import.meta.url), 'utf8');
const routing = readFileSync(new URL('../apps/web/src/outreach-routing.ts', import.meta.url), 'utf8');

assert.equal(vercel.rewrites?.find((rewrite) => rewrite.source === '/portfolio')?.destination, '/api/dashboard?__path=/portfolio');
assert.equal(vercel.rewrites?.find((rewrite) => rewrite.source === '/api/portfolio-catalog')?.destination, '/api/dashboard?__path=/api/portfolio-catalog');
assert.match(dashboard, /loadApprovedPortfolioIntoRuntime/);
assert.match(dashboard, /loadApprovedPortfolioCatalog/);
assert.match(dashboard, /apply_portfolio_shell/);
assert.match(dashboard, /activeRoute: '\/portfolio'/);
assert.match(shell, /applySpecializedPageShell/);
assert.match(shell, /prospect-desk-shell\.v2\.css/);
assert.match(runtime, /Only Admin and Waseem|restricted to Admin and Waseem/);
assert.match(runtime, /approvedProofStatement/);
assert.match(runtime, /doNotDisclose/);
assert.match(catalog, /CREATE TABLE IF NOT EXISTS portfolio_catalog/);
assert.match(catalog, /assetHealth !== 'broken'/);
assert.match(routing, /return '\/portfolio'/);

const approved = approvedStarterPortfolioItems.filter((item) => item.approvalStatus === 'approved');
assert.ok(approved.length >= 3);
assert.ok(approved.every((item) => item.approvedProofStatement && item.approvedBy && item.approvedAt));
assert.ok(approved.every((item) => item.confidentiality !== 'private'));
assert.ok(approved.flatMap((item) => item.assetUrls).every((url) => /^https:\/\//.test(url)));

console.log('Managed portfolio catalog, shared shell and deployment wiring smoke tests passed');
