import assert from 'node:assert/strict';

process.env.ADMIN_PASSWORD = 'smoke-admin-value';
process.env.TALHA_DASHBOARD_PASSWORD = 'smoke-talha-value';
process.env.SESSION_SECRET = 'smoke-session-secret-1234567890';

const module = await import('../api/dashboard.ts');
const handler = module.default as { fetch(request: Request): Promise<Response> };
const identifier = 'talha.bashir@codistan.org';
const clientAddress = '203.0.113.44';

async function login(password: string): Promise<Response> {
  return handler.fetch(new Request('https://example.test/api/dashboard?__path=/api/login', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': clientAddress,
    },
    body: JSON.stringify({ identifier, password }),
  }));
}

for (let attempt = 0; attempt < 5; attempt += 1) {
  assert.equal((await login('invalid-smoke-value')).status, 401);
}

const blockedInvalid = await login('invalid-smoke-value');
assert.equal(blockedInvalid.status, 429);
assert.ok(Number(blockedInvalid.headers.get('retry-after')) > 0);

const validAfterLockout = await login(process.env.TALHA_DASHBOARD_PASSWORD);
assert.equal(validAfterLockout.status, 200);
const payload = await validAfterLockout.json();
assert.equal(payload.identifier, identifier);
assert.equal(payload.access.scope, 'team');

console.log('Dashboard valid-login lockout recovery smoke test passed');
