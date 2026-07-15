import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applySpecializedPageShell } from '../vercel/workspace-pages.js';

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
assert.match(dashboard, /apply_priority_shell/);
assert.match(dashboard, /activeRoute: '\/priorities'/);
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

const specialized = applySpecializedPageShell(
  '<!doctype html><html><head><title>Priority Opportunities</title><style></style></head><body><main class="shell"><header><div><p>Old heading</p></div><div class="actions"><button id="rescore">Rescore</button></div></header><section class="panel">Queue</section></main><script></script></body></html>',
  {
    activeRoute: '/priorities',
    eyebrow: 'Owner action queue',
    title: 'Priority Opportunities',
    description: 'Closeability ranking.',
    actor: 'Talha Bashir',
    scopeLabel: 'Talha team leads',
  },
);
assert.match(specialized, /class="nav-item active" href="\/priorities" aria-current="page"/);
assert.match(specialized, /id="workspace-sidebar"/);
assert.match(specialized, /id="rescore"/);
assert.match(specialized, /Talha Bashir · Talha team leads/);
assert.match(specialized, /prospect-desk-shell\.v2\.css/);
assert.match(specialized, /prospect-desk-shell\.v2\.js/);
assert.match(specialized, /data-shell-logout/);
assert.match(specialized, /class="specialized-content"/);

console.log('Closeability scoring, scoped priority workspace, shared shell and duplicate-free rescore deployment contracts passed');
