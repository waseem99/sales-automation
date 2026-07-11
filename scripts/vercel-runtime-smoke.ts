import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

interface VercelConfig {
  redirects?: Array<{ source: string; destination: string; permanent?: boolean }>;
  rewrites?: Array<{ source: string; destination: string }>;
}

async function main(): Promise<void> {
  process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'vercel-smoke-password';
  process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'vercel-smoke-session-secret-123456789';

  const config = JSON.parse(
    readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'),
  ) as VercelConfig;
  const rewriteSources = (config.rewrites ?? []).map((rewrite) => rewrite.source);
  const rootRedirect = (config.redirects ?? []).find((redirect) => redirect.source === '/');

  assert.equal(rootRedirect?.destination, '/prospects');
  assert.ok(rewriteSources.includes('/prospects'));
  assert.ok(rewriteSources.includes('/api/login'));
  assert.ok(rewriteSources.includes('/api/prospects/:path*'));
  assert.ok(!rewriteSources.includes('/:path*'), 'Vercel internal routes must not be captured by a global rewrite.');
  assert.ok(!rewriteSources.includes('/api/preview'), 'Vercel preview routes must remain owned by Vercel.');

  const module = await import('../api/index.ts');
  const handler = module.default as { fetch(request: Request): Promise<Response> };

  const health = await handler.fetch(new Request('https://example.test/api/index?__path=/health'));
  assert.equal(health.status, 200);
  const healthBody = await health.json() as Record<string, unknown>;
  assert.equal(healthBody.ok, true);
  assert.equal(healthBody.service, 'codistan-prospect-desk');

  const login = await handler.fetch(new Request('https://example.test/api/index?__path=/login'));
  assert.equal(login.status, 200);
  const loginHtml = await login.text();
  assert.match(loginHtml, /Codistan Prospect Desk/i);
  assert.match(loginHtml, /Admin password/i);

  const loginAction = await handler.fetch(new Request('https://example.test/api/index?__path=/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: process.env.ADMIN_PASSWORD }),
  }));
  assert.equal(loginAction.status, 200);
  assert.match(loginAction.headers.get('set-cookie') ?? '', /^codistan_admin_session=/);
  assert.deepEqual(await loginAction.json(), { ok: true });

  console.log('Vercel runtime and explicit routing smoke tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
