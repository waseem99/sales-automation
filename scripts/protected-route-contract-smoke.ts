import assert from 'node:assert/strict';
import dashboard from '../api/dashboard.js';
import {
  resolveRuntimeRoute,
  roleCanAccessRoute,
  runtimeErrorResponse,
  runtimeFailureDetails,
  runtimeRouteContracts,
  type RuntimeRole,
} from '../vercel/runtime-contract.js';

async function main(): Promise<void> {
  const originalEnvironment = { ...process.env };
  Object.assign(process.env, {
    ADMIN_PASSWORD: 'admin-password-for-route-contract',
    SESSION_SECRET: 'route-contract-session-secret-32-bytes-minimum',
    DATABASE_URL: 'postgresql://route-contract.invalid/sales',
    WASEEM_DASHBOARD_PASSWORD: 'waseem-password-for-route-contract',
    TALHA_DASHBOARD_PASSWORD: 'talha-password-for-route-contract',
    MOIZ_DASHBOARD_PASSWORD: 'moiz-password-for-route-contract',
  });

  try {
    const ids = runtimeRouteContracts.map((route) => route.id);
    assert.equal(new Set(ids).size, ids.length, 'route contract IDs must be unique');

    for (const route of runtimeRouteContracts) {
      assert.equal(resolveRuntimeRoute(route.samplePath, route.method)?.id, route.id, `${route.id} must resolve from its sample path`);
    }

    const protectedGetRoutes = runtimeRouteContracts.filter((route) => route.method === 'GET' && !route.access.includes('public'));
    for (const route of protectedGetRoutes) {
      const response = await dashboard.fetch(new Request(`https://local.invalid${route.samplePath}`, {
        method: 'GET',
        headers: { accept: route.response === 'html' ? 'text/html' : 'application/json' },
      }));
      assert.equal(response.status, route.response === 'html' ? 302 : 401, `${route.id} must reject unauthenticated access`);
      if (route.response === 'html') assert.equal(response.headers.get('location'), '/login');
    }

    const expectedAccess: Array<{ identifier: string; password: string; role: RuntimeRole; scope: string }> = [
      { identifier: 'admin', password: process.env.ADMIN_PASSWORD!, role: 'admin', scope: 'all' },
      { identifier: 'waseem@codistan.org', password: process.env.WASEEM_DASHBOARD_PASSWORD!, role: 'admin', scope: 'all' },
      { identifier: 'talha.bashir@codistan.org', password: process.env.TALHA_DASHBOARD_PASSWORD!, role: 'team_lead', scope: 'team' },
      { identifier: 'moiz.khalid@codistan.org', password: process.env.MOIZ_DASHBOARD_PASSWORD!, role: 'bd_user', scope: 'own' },
    ];

    for (const expected of expectedAccess) {
      const response = await dashboard.fetch(new Request('https://local.invalid/api/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ identifier: expected.identifier, password: expected.password }),
      }));
      assert.equal(response.status, 200, `${expected.identifier} must authenticate in the route contract smoke`);
      const body = await response.json() as { access?: { role?: string; scope?: string } };
      assert.equal(body.access?.role, expected.role);
      assert.equal(body.access?.scope, expected.scope);
    }

    const sourceControls = resolveRuntimeRoute('/api/source-controls', 'POST');
    assert(sourceControls);
    assert.equal(roleCanAccessRoute(sourceControls, 'admin'), true);
    assert.equal(roleCanAccessRoute(sourceControls, 'team_lead'), false);
    assert.equal(roleCanAccessRoute(sourceControls, 'bd_user'), false);

    const operations = resolveRuntimeRoute('/operations', 'GET');
    assert(operations);
    assert.equal(roleCanAccessRoute(operations, 'admin'), true);
    assert.equal(roleCanAccessRoute(operations, 'team_lead'), true);
    assert.equal(roleCanAccessRoute(operations, 'bd_user'), true);

    const failure = runtimeFailureDetails(new Error('private database detail must not be exposed'), 'route_contract_test');
    const jsonFailure = runtimeErrorResponse(new Request('https://local.invalid/prospects', { headers: { accept: 'application/json' } }), failure);
    assert.equal(jsonFailure.status, 500);
    assert.equal(jsonFailure.headers.get('x-runtime-reference'), failure.referenceId);
    const jsonBody = await jsonFailure.text();
    assert.equal(jsonBody.includes('private database detail'), false);
    assert.equal(jsonBody.includes(failure.referenceId), true);

    const htmlFailure = runtimeErrorResponse(new Request('https://local.invalid/prospects', { headers: { accept: 'text/html' } }), failure);
    const htmlBody = await htmlFailure.text();
    assert.equal(htmlBody.includes('private database detail'), false);
    assert.equal(htmlBody.includes(failure.referenceId), true);

    console.log(`Protected route contract verified for ${runtimeRouteContracts.length} route entries`);
  } finally {
    process.env = originalEnvironment;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
