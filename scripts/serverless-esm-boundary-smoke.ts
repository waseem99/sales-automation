import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const protectedFiles = [
  '../api/lead-signals.ts',
  '../vercel/portfolio-catalog-runtime.ts',
  '../vercel/operations-runtime.ts',
  '../vercel/linkedin-warm-signal-engine.ts',
  '../vercel/upwork-saved-search-engine.ts',
];
const staticSalesAutomationImport = /import\s+(?!type\b)[\s\S]*?from\s+['"]@sales-automation\//m;

for (const relativePath of protectedFiles) {
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
  assert.equal(
    staticSalesAutomationImport.test(source),
    false,
    `${relativePath} must not statically import an ESM @sales-automation package from a Vercel runtime boundary`,
  );
}

const portfolio = readFileSync(new URL('../vercel/portfolio-catalog-runtime.ts', import.meta.url), 'utf8');
assert.equal(portfolio.includes("import('@sales-automation/neon-state/portfolio-catalog')"), true);

const operations = readFileSync(new URL('../vercel/operations-runtime.ts', import.meta.url), 'utf8');
assert.equal(operations.includes("import('@sales-automation/neon-state')"), true);
assert.equal(operations.includes("import('@sales-automation/neon-state/source-controls')"), true);

const signalApi = readFileSync(new URL('../api/lead-signals.ts', import.meta.url), 'utf8');
assert.equal(signalApi.includes("import('@sales-automation/neon-state')"), true);
assert.equal(signalApi.includes("import('../vercel/linkedin-warm-signal-engine.js')"), true);
assert.equal(signalApi.includes("import('../vercel/upwork-saved-search-engine.js')"), true);
assert.equal(signalApi.includes("import('../vercel/operations-runtime.js')"), true);

const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')) as {
  functions?: Record<string, unknown>;
  rewrites?: Array<{ source: string; destination: string }>;
};
assert.equal(Boolean(vercel.functions?.['api/operations.ts']), false);
assert.equal(vercel.rewrites?.find((item) => item.source === '/operations')?.destination, '/api/lead-signals?__path=/operations');
assert.equal(vercel.rewrites?.find((item) => item.source === '/api/source-controls')?.destination, '/api/lead-signals?__path=/api/source-controls');

console.log('Portfolio, Operations and Signal Intake keep ESM packages behind dynamic serverless boundaries');
