import assert from 'node:assert/strict';

process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'vercel-smoke-password';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'vercel-smoke-session-secret-123456789';

const module = await import('../api/index.ts');
const handler = module.default as { fetch(request: Request): Promise<Response> };

const health = await handler.fetch(new Request('https://example.test/health'));
assert.equal(health.status, 200);
const healthBody = await health.json() as Record<string, unknown>;
assert.equal(healthBody.ok, true);
assert.equal(healthBody.service, 'codistan-prospect-desk');

const login = await handler.fetch(new Request('https://example.test/login'));
assert.equal(login.status, 200);
const loginHtml = await login.text();
assert.match(loginHtml, /Codistan Prospect Desk/i);
assert.match(loginHtml, /Admin password/i);

console.log('Vercel runtime smoke test passed');
