import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
  scripts?: Record<string, string>;
};
const vercel = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8')) as {
  buildCommand?: string;
  crons?: Array<{ path?: string }>;
  rewrites?: Array<{ source?: string; destination?: string }>;
};
const workflow = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
const releaseDoc = await readFile(new URL('../docs/RELEASE_GATE.md', import.meta.url), 'utf8');

assert.match(vercel.buildCommand ?? '', /pnpm build:vercel/);
assert.match(packageJson.scripts?.['build:vercel'] ?? '', /pnpm build/);
assert.match(packageJson.scripts?.['build:vercel'] ?? '', /pnpm test:vercel-runtime/);
assert.match(packageJson.scripts?.['test:delivery-observability'] ?? '', /operational-telemetry\.test\.ts/);
assert.match(packageJson.scripts?.['test:delivery-observability'] ?? '', /delivery-telemetry-smoke\.ts/);
assert.match(packageJson.scripts?.['deploy:check'] ?? '', /test:delivery-observability/);
assert.ok(vercel.crons?.some((cron) => cron.path === '/api/cron/outreach'));
assert.ok(vercel.rewrites?.some((rewrite) => rewrite.source === '/delivery-health' && rewrite.destination === '/api/delivery-health'));
assert.match(workflow, /name:\s*Repository CI \(best effort\)/);
assert.match(workflow, /actions\/checkout@v4/);
assert.match(workflow, /pnpm deploy:check/);
assert.match(releaseDoc, /production Vercel deployment is the enforced release gate/i);
assert.match(releaseDoc, /successful[^\n]*Vercel[^\n]*status/i);

console.log('Vercel release gate and layered observability verification contract passed');
