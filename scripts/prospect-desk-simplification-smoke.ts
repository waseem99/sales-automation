import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const workspace = readFileSync(resolve(root, 'vercel/workspace-pages.ts'), 'utf8');
const linkedin = readFileSync(resolve(root, 'vercel/linkedin-warm-signals-runtime.ts'), 'utf8');
const shellCss = readFileSync(resolve(root, 'public/assets/prospect-desk-shell.v2.css'), 'utf8');

assert.match(workspace, /id: 'daily-work'/);
assert.match(workspace, /href: '\/prospects', text: 'Prospects'/);
assert.match(workspace, /href: '\/priorities', text: 'Priorities'/);
assert.match(workspace, /href: '\/operations', text: 'Operations'/);
assert.doesNotMatch(workspace, /id: 'warm-leads'/);
assert.doesNotMatch(workspace, /id: 'procurement'/);
assert.doesNotMatch(workspace, /id: 'services',\s*label: 'Services'/);
assert.match(workspace, /id: 'tools',\s*label: 'More'/);
assert.match(workspace, /href: '\/linkedin-signals', text: 'LinkedIn intake'/);
assert.match(workspace, /const workspaceTabs:/);
for (const route of ['/leads/linkedin', '/leads/upwork', '/leads/tenders', '/leads/research', '/leads/partnerships', '/services']) {
  assert.ok(workspace.includes(`href: '${route}'`), `Missing compact workspace tab for ${route}`);
}
assert.match(shellCss, /\.workspace-tabs\{/);
assert.match(shellCss, /\.workspace-tab\.active\{/);

assert.match(linkedin, /intakeMode === 'research'/);
assert.match(linkedin, /sourceKind: 'public_url'/);
assert.match(linkedin, /requiredLinkedInUrl/);
assert.match(linkedin, /enrichRepositoryContacts/);
assert.match(linkedin, /evaluateLead/);
assert.match(linkedin, /linkedin_research::profile_or_company_url/);
assert.match(linkedin, /externalActionAutomated: false/);
assert.match(linkedin, /No logged-in LinkedIn crawling/);
assert.doesNotMatch(linkedin.toLowerCase(), /playwright|puppeteer|selenium/);
assert.doesNotMatch(linkedin, /connection request[^<]*sent automatically/i);

console.log('Prospect Desk simplification and LinkedIn-assisted intake smoke passed.');
