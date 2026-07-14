import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluateLead } from '@sales-automation/evaluator';
import { sampleLeads, samplePortfolioItems } from '@sales-automation/fixtures';

const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')) as {
  rewrites?: Array<{ source: string; destination: string }>;
};
const dashboard = readFileSync(new URL('../api/dashboard.ts', import.meta.url), 'utf8');
const priorityRuntime = readFileSync(new URL('../vercel/priority-queue-runtime.ts', import.meta.url), 'utf8');
const qualityRunner = readFileSync(new URL('../packages/prospect-discovery/src/quality-runner.ts', import.meta.url), 'utf8');

assert.equal(vercel.rewrites?.find((rewrite) => rewrite.source === '/priorities')?.destination, '/api/dashboard?__path=/priorities');
assert.equal(vercel.rewrites?.find((rewrite) => rewrite.source === '/api/closeability-rescore')?.destination, '/api/dashboard?__path=/api/closeability-rescore');
assert.match(dashboard, /load_priority_queue_runtime/);
assert.match(priorityRuntime, /Your top five immediate actions/);
assert.match(priorityRuntime, /rescoring is restricted to Admin and Waseem/);
assert.match(priorityRuntime, /duplicatesCreated: 0/);
assert.match(qualityRunner, /closeabilityRescoredCount/);
assert.match(qualityRunner, /closeability-rescore/);

const lead = sampleLeads.find((item) => item.id === 'lead-linkedin-ai-001');
assert.ok(lead);
const evaluation = evaluateLead({
  lead: {
    ...lead,
    companyName: 'Example Operations Company',
    companyWebsite: 'https://examplecompany.co',
    contactEmail: 'founder@examplecompany.co',
    description: 'The founder is seeking an external implementation partner to automate customer support and internal operations with AI agents. The company wants to start immediately.',
    opportunityStatus: 'live_opportunity',
  },
  portfolioItems: samplePortfolioItems,
  generatedAt: '2026-07-08T18:30:00.000Z',
});

assert.equal(typeof evaluation.closeability.total, 'number');
assert.ok(evaluation.closeability.total >= 0 && evaluation.closeability.total <= 100);
assert.ok(['priority_a', 'priority_b', 'research', 'reject'].includes(evaluation.closeability.band));
assert.equal(evaluation.closeability.breakdown.activeRequirement, 20);
assert.equal(evaluation.closeability.breakdown.buyerIdentified, 10);
assert.equal(evaluation.closeability.breakdown.verifiedContactRoute, 10);
assert.equal(
  Object.values(evaluation.closeability.breakdown).reduce((sum, value) => sum + value, 0),
  evaluation.closeability.total,
);
assert.ok(evaluation.closeability.explanation.includes('/100'));

console.log('Closeability score contract, owner priority workspace and duplicate-free rescore wiring tests passed');
