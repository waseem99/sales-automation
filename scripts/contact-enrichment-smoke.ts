import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  enrichRepositoryContacts,
  getStoredContactEnrichment,
  verifyPublicContactEnrichment,
} from '@sales-automation/prospect-discovery';

assert.equal(typeof enrichRepositoryContacts, 'function');
assert.equal(typeof verifyPublicContactEnrichment, 'function');
assert.equal(typeof getStoredContactEnrichment, 'function');

const apiSource = await readFile(new URL('../api/contact-enrichment.ts', import.meta.url), 'utf8');
assert.match(apiSource, /restricted to Admin and Waseem/);
assert.match(apiSource, /acquireNamedRunLock/);
assert.match(apiSource, /maxRecords[^\n]*50/);
assert.match(apiSource, /duplicatesCreated:\s*0/);
assert.match(apiSource, /persistNeonAppState/);
assert.doesNotMatch(apiSource, /scrape|puppeteer|playwright/i);

const vercelConfig = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8')) as {
  functions?: Record<string, { maxDuration?: number }>;
};
assert.equal(vercelConfig.functions?.['api/contact-enrichment.ts']?.maxDuration, 300);

console.log('Verified contact enrichment package export and deployment contract passed');