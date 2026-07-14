import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')) as {
  rewrites?: Array<{ source: string; destination: string }>;
};
const dashboard = readFileSync(new URL('../api/dashboard.ts', import.meta.url), 'utf8');
const priorityRuntime = readFileSync(new URL('../vercel/priority-queue-runtime.ts', import.meta.url), 'utf8');
const qualityRunner = readFileSync(new URL('../packages/prospect-discovery/src/quality-runner.ts', import.meta.url), 'utf8');
const evaluator = readFileSync(new URL('../packages/evaluator/src/index.ts', import.meta.url), 'utf8');
const closeability = readFileSync(new URL('../packages/evaluator/src/closeability.ts', import.meta.url), 'utf8');
const evaluatorTest = readFileSync(new URL('../packages/evaluator/src/index.test.ts', import.meta.url), 'utf8');

assert.equal(vercel.rewrites?.find((rewrite) => rewrite.source === '/priorities')?.destination, '/api/dashboard?__path=/priorities');
assert.equal(vercel.rewrites?.find((rewrite) => rewrite.source === '/api/closeability-rescore')?.destination, '/api/dashboard?__path=/api/closeability-rescore');
assert.match(dashboard, /load_priority_queue_runtime/);
assert.match(priorityRuntime, /Your top five immediate actions/);
assert.match(priorityRuntime, /rescoring is restricted to Admin and Waseem/);
assert.match(priorityRuntime, /duplicatesCreated: 0/);
assert.match(priorityRuntime, /visibleOwnerTokens/);
assert.match(qualityRunner, /closeabilityRescoredCount/);
assert.match(qualityRunner, /closeability-rescore/);
assert.match(evaluator, /scoreCloseability/);
assert.match(evaluator, /score\.status === 'rejected'/);
assert.match(evaluator, /band: 'reject'/);
assert.match(closeability, /activeRequirement: number/);
assert.match(closeability, /verifiedContactRoute: number/);
assert.match(closeability, /matchingProof: number/);
assert.match(closeability, /sourceReliability: number/);
assert.match(closeability, /Priority A|priority_a/);
assert.match(evaluatorTest, /closeability\.breakdown\.activeRequirement/);
assert.match(evaluatorTest, /closeability\.breakdown\.buyerIdentified/);
assert.match(evaluatorTest, /closeability\.breakdown\.verifiedContactRoute/);
assert.match(evaluatorTest, /closeability\.band, 'reject'/);

console.log('Closeability scoring, scoped priority workspace and duplicate-free rescore deployment contracts passed');
