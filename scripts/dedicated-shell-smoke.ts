import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  applyDedicatedWorkspaceShell,
  serveDedicatedWorkspace,
} from '../vercel/dedicated-page-shell.ts';

const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')) as {
  functions?: Record<string, { maxDuration?: number }>;
  rewrites?: Array<{ source: string; destination: string }>;
};

const entries = [
  { route: '/lead-signals', file: 'lead-signals' },
  { route: '/linkedin-signals', file: 'linkedin-signals' },
  { route: '/tenders', file: 'tenders' },
  { route: '/re-engagement', file: 're-engagement' },
  { route: '/delivery-health', file: 'delivery-health' },
] as const;

for (const entry of entries) {
  const functionPath = `api/${entry.file}.ts`;
  assert.equal(config.functions?.[functionPath]?.maxDuration, 300);
  assert.equal(config.rewrites?.find((rewrite) => rewrite.source === entry.route)?.destination, `/api/${entry.file}`);
  const wrapper = readFileSync(new URL(`../api/${entry.file}.ts`, import.meta.url), 'utf8');
  const core = readFileSync(new URL(`../vercel/${entry.file}-core.ts`, import.meta.url), 'utf8');
  assert.match(wrapper, /serveDedicatedWorkspace/);
  assert.match(wrapper, new RegExp(`activeRoute:\\s*'${entry.route.replace('/', '\\/')}'`));
  assert.match(wrapper, new RegExp(`import\\('\\.\\.\\/vercel\\/${entry.file}-core\\.js'\\)`));
  assert.ok(core.length > 500, `${entry.file}-core.ts must retain the original handler implementation`);
  assert.match(core, /export const maxDuration = 300/);
}

const cookie = `codistan_admin_actor=${Buffer.from('waseem@codistan.org').toString('base64url')}.synthetic`;
const wrapped = await serveDedicatedWorkspace(
  new Request('https://local.invalid/lead-signals', { headers: { accept: 'text/html', cookie } }),
  async () => ({
    default: {
      fetch: async () => new Response(
        '<!doctype html><html><head><title>Signals</title></head><body><main><header><div><h1>Old</h1></div><nav><a href="/prospects">Prospects</a></nav></header><form action="/api/lead-signals"></form><section class="panel">Signals</section></main></body></html>',
        { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'x-original': 'preserved' } },
      ),
    },
  }),
  {
    activeRoute: '/lead-signals',
    eyebrow: 'Controlled intake',
    title: 'Lead Signals',
    description: 'Shared shell regression.',
    scopeMode: 'admin',
  },
);
assert.equal(wrapped.status, 200);
assert.equal(wrapped.headers.get('x-original'), 'preserved');
assert.equal(wrapped.headers.get('x-prospect-shell'), 'shared-v2');
const body = await wrapped.text();
assert.match(body, /id="workspace-sidebar"/);
assert.match(body, /class="nav-item active" href="\/lead-signals" aria-current="page"/);
assert.match(body, /Waseem Khan · Admin\/Waseem · all company data/);
assert.match(body, /action="\/lead-signals"/);
assert.doesNotMatch(body, /action="\/api\/lead-signals"/);
assert.match(body, /prospect-desk-shell\.v2\.css/);
assert.match(body, /prospect-desk-shell\.v2\.js/);

const fallbackHeader = await applyDedicatedWorkspaceShell(
  new Request('https://local.invalid/re-engagement', { headers: { cookie } }),
  new Response('<!doctype html><html><head><title>Saved</title></head><body><main><section class="panel"><h1>Saved</h1><a href="/api/re-engagement">Return</a></section></main></body></html>', {
    status: 201,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  }),
  { activeRoute: '/re-engagement', eyebrow: 'Relationships', title: 'Re-engagement', description: 'Fallback header regression.', scopeMode: 'admin' },
);
const fallbackBody = await fallbackHeader.text();
assert.equal(fallbackHeader.status, 201);
assert.match(fallbackBody, /class="topbar specialized-topbar"/);
assert.match(fallbackBody, /href="\/re-engagement"/);
assert.doesNotMatch(fallbackBody, /href="\/api\/re-engagement"/);

const json = await applyDedicatedWorkspaceShell(
  new Request('https://local.invalid/tenders', { headers: { cookie } }),
  Response.json({ ok: true }),
  { activeRoute: '/tenders', eyebrow: 'Procurement', title: 'Tenders', description: 'JSON.', scopeMode: 'tenders' },
);
assert.equal(json.headers.get('x-prospect-shell'), null);
assert.deepEqual(await json.json(), { ok: true });

const failure = await applyDedicatedWorkspaceShell(
  new Request('https://local.invalid/delivery-health', { headers: { cookie } }),
  new Response('<html><body>failure</body></html>', { status: 500, headers: { 'content-type': 'text/html' } }),
  { activeRoute: '/delivery-health', eyebrow: 'Telemetry', title: 'Delivery Health', description: 'Failure.', scopeMode: 'admin' },
);
assert.equal(failure.status, 500);
assert.equal(failure.headers.get('x-prospect-shell'), null);

const originalConsoleError = console.error;
console.error = () => undefined;
try {
  const malformed = await applyDedicatedWorkspaceShell(
    new Request('https://local.invalid/delivery-health', { headers: { cookie } }),
    new Response('<!doctype html><html><body><section>No main element</section></body></html>', { status: 200, headers: { 'content-type': 'text/html' } }),
    { activeRoute: '/delivery-health', eyebrow: 'Telemetry', title: 'Delivery Health', description: 'Fallback.', scopeMode: 'admin' },
  );
  assert.equal(malformed.headers.get('x-prospect-shell'), null);
  assert.equal((await malformed.text()).includes('workspace-sidebar'), false);
} finally {
  console.error = originalConsoleError;
}

console.log(`Dedicated shared shell verified for ${entries.length} isolated workspace handlers`);
