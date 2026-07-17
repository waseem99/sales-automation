import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const workspace = readFileSync(resolve(root, 'vercel/workspace-pages.ts'), 'utf8');
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

console.log('Prospect Desk navigation simplification smoke passed.');
