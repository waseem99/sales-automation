import assert from 'node:assert/strict';

type ExpectedRole = 'admin' | 'team_lead' | 'bd_user';
type ExpectedScope = 'all' | 'team' | 'own';

interface AcceptanceAccount {
  label: 'admin' | 'team-lead' | 'bd-user';
  identifier: string;
  password: string;
  expectedRole: ExpectedRole;
  expectedScope: ExpectedScope;
}

interface SessionPayload {
  authenticated?: boolean;
  access?: {
    role?: string;
    scope?: string;
  };
}

interface LoginPayload {
  ok?: boolean;
  access?: {
    role?: string;
    scope?: string;
  };
}

const authenticatedRoutes = [
  '/prospects',
  '/priorities',
  '/portfolio',
  '/operations',
  '/tenders',
] as const;

const adminOnlyRoutes = [
  '/lead-signals',
  '/linkedin-signals',
  '/re-engagement',
  '/delivery-health',
] as const;

async function main(): Promise<void> {
  const baseUrl = normalizeBaseUrl(requireEnvironment('PRODUCTION_ACCEPTANCE_BASE_URL'));
  const accounts: AcceptanceAccount[] = [
    {
      label: 'admin',
      identifier: process.env.PRODUCTION_ACCEPTANCE_ADMIN_IDENTIFIER?.trim() || 'admin',
      password: requireEnvironment('PRODUCTION_ACCEPTANCE_ADMIN_PASSWORD'),
      expectedRole: 'admin',
      expectedScope: 'all',
    },
    {
      label: 'team-lead',
      identifier: process.env.PRODUCTION_ACCEPTANCE_TEAM_LEAD_IDENTIFIER?.trim() || 'talha.bashir@codistan.org',
      password: requireEnvironment('PRODUCTION_ACCEPTANCE_TEAM_LEAD_PASSWORD'),
      expectedRole: 'team_lead',
      expectedScope: 'team',
    },
    {
      label: 'bd-user',
      identifier: process.env.PRODUCTION_ACCEPTANCE_BD_IDENTIFIER?.trim() || 'hibasohail@codistan.org',
      password: requireEnvironment('PRODUCTION_ACCEPTANCE_BD_PASSWORD'),
      expectedRole: 'bd_user',
      expectedScope: 'own',
    },
  ];

  let checks = 0;
  for (const account of accounts) {
    const cookie = await login(baseUrl, account);
    checks += 1;

    const session = await request(baseUrl, '/api/session', cookie, 'application/json');
    assert.equal(session.status, 200, `${account.label} session must return 200`);
    const sessionPayload = await session.json() as SessionPayload;
    assert.equal(sessionPayload.authenticated, true, `${account.label} session must remain authenticated`);
    assert.equal(sessionPayload.access?.role, account.expectedRole, `${account.label} role must match`);
    assert.equal(sessionPayload.access?.scope, account.expectedScope, `${account.label} scope must match`);
    record(account.label, '/api/session', session.status);
    checks += 1;

    for (const path of authenticatedRoutes) {
      const response = await request(baseUrl, path, cookie, 'text/html');
      assert.equal(response.status, 200, `${account.label} ${path} must return 200`);
      record(account.label, path, response.status);
      checks += 1;
    }

    for (const path of adminOnlyRoutes) {
      const response = await request(baseUrl, path, cookie, 'text/html');
      const expectedStatus = account.expectedRole === 'admin' ? 200 : 403;
      assert.equal(response.status, expectedStatus, `${account.label} ${path} must return ${expectedStatus}`);
      record(account.label, path, response.status);
      checks += 1;
    }
  }

  console.log(`Sanitized production route acceptance passed: ${accounts.length} role accounts, ${checks} checks.`);
}

async function login(baseUrl: string, account: AcceptanceAccount): Promise<string> {
  const response = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ identifier: account.identifier, password: account.password }),
  });
  assert.equal(response.status, 200, `${account.label} login must return 200`);
  const payload = await response.json() as LoginPayload;
  assert.equal(payload.ok, true, `${account.label} login must succeed`);
  assert.equal(payload.access?.role, account.expectedRole, `${account.label} login role must match`);
  assert.equal(payload.access?.scope, account.expectedScope, `${account.label} login scope must match`);
  const cookie = cookieHeader(response.headers);
  assert(cookie.includes('codistan_admin_session='), `${account.label} login must set the session cookie`);
  assert(cookie.includes('codistan_admin_actor='), `${account.label} login must set the actor cookie`);
  record(account.label, '/api/login', response.status);
  return cookie;
}

async function request(baseUrl: string, path: string, cookie: string, accept: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'GET',
    redirect: 'manual',
    headers: { accept, cookie },
  });
}

function cookieHeader(headers: Headers): string {
  const getSetCookie = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  const values = typeof getSetCookie === 'function'
    ? getSetCookie.call(headers)
    : splitCombinedSetCookie(headers.get('set-cookie') ?? '');
  return values
    .map((value) => value.split(';', 1)[0]?.trim())
    .filter((value): value is string => Boolean(value))
    .join('; ');
}

function splitCombinedSetCookie(value: string): string[] {
  if (!value.trim()) return [];
  return value.split(/,\s*(?=[^;,\s]+=)/g);
}

function normalizeBaseUrl(value: string): string {
  const url = new URL(value);
  const localHost = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  assert(url.protocol === 'https:' || (url.protocol === 'http:' && localHost), 'PRODUCTION_ACCEPTANCE_BASE_URL must use HTTPS except for localhost');
  return url.toString().replace(/\/$/, '');
}

function requireEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function record(account: AcceptanceAccount['label'], path: string, status: number): void {
  console.log(`PASS ${account} ${path} -> ${status}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
