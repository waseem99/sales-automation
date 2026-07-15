import assert from 'node:assert/strict';

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
    const [dashboardModule, contract] = await Promise.all([
      import('../api/dashboard.ts'),
      import('../vercel/runtime-contract.ts'),
    ]);
    const dashboard = moduleHandler(dashboardModule);

    const ids = contract.runtimeRouteContracts.map((route) => route.id);
    assert.equal(new Set(ids).size, ids.length, 'route contract IDs must be unique');

    for (const route of contract.runtimeRouteContracts) {
      assert.equal(contract.resolveRuntimeRoute(route.samplePath, route.method)?.id, route.id, `${route.id} must resolve from its sample path`);
    }

    const dashboardProtectedGetRoutes = contract.runtimeRouteContracts.filter((route) => (
      route.method === 'GET'
      && route.target !== 'dedicated'
      && !route.access.includes('public')
    ));
    for (const route of dashboardProtectedGetRoutes) {
      const response = await dashboard.fetch(new Request(`https://local.invalid${route.samplePath}`, {
        method: 'GET',
        headers: { accept: route.response === 'html' ? 'text/html' : 'application/json' },
      }));
      assert.equal(response.status, route.response === 'html' ? 302 : 401, `${route.id} must reject unauthenticated access`);
      if (route.response === 'html') assert.equal(response.headers.get('location'), '/login');
    }

    const dedicatedHandlers = [
      { id: 'signal-intake', path: '/lead-signals', expectedStatus: 401, load: () => import('../api/lead-signals.ts') },
      { id: 'linkedin-signals', path: '/linkedin-signals', expectedStatus: 401, load: () => import('../api/linkedin-signals.ts') },
      { id: 'tenders', path: '/tenders', expectedStatus: 302, load: () => import('../api/tenders.ts') },
      { id: 're-engagement', path: '/re-engagement', expectedStatus: 401, load: () => import('../api/re-engagement.ts') },
      { id: 'delivery-health', path: '/delivery-health', expectedStatus: 401, load: () => import('../api/delivery-health.ts') },
    ] as const;

    for (const dedicated of dedicatedHandlers) {
      const route = contract.resolveRuntimeRoute(dedicated.path, 'GET');
      assert.equal(route?.id, dedicated.id);
      assert.equal(route?.target, 'dedicated');
      const module = await dedicated.load();
      const handler = moduleHandler(module);
      const response = await handler.fetch(new Request(`https://local.invalid${dedicated.path}`, {
        method: 'GET',
        headers: { accept: 'text/html' },
      }));
      assert.equal(response.status, dedicated.expectedStatus, `${dedicated.id} must load and reject unauthenticated access safely`);
      if (dedicated.expectedStatus === 302) assert.equal(response.headers.get('location'), '/login');
    }

    const expectedAccess = [
      { identifier: 'admin', password: process.env.ADMIN_PASSWORD!, role: 'admin', scope: 'all' },
      { identifier: 'waseem@codistan.org', password: process.env.WASEEM_DASHBOARD_PASSWORD!, role: 'admin', scope: 'all' },
      { identifier: 'talha.bashir@codistan.org', password: process.env.TALHA_DASHBOARD_PASSWORD!, role: 'team_lead', scope: 'team' },
      { identifier: 'moiz.khalid@codistan.org', password: process.env.MOIZ_DASHBOARD_PASSWORD!, role: 'bd_user', scope: 'own' },
    ] as const;

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

    const sourceControls = contract.resolveRuntimeRoute('/api/source-controls', 'POST');
    assert(sourceControls);
    assert.equal(contract.roleCanAccessRoute(sourceControls, 'admin'), true);
    assert.equal(contract.roleCanAccessRoute(sourceControls, 'team_lead'), false);
    assert.equal(contract.roleCanAccessRoute(sourceControls, 'bd_user'), false);

    for (const adminOnlyId of ['signal-intake', 'linkedin-signals', 're-engagement', 'delivery-health']) {
      const route = contract.runtimeRouteContracts.find((candidate) => candidate.id === adminOnlyId);
      assert(route);
      assert.equal(contract.roleCanAccessRoute(route, 'admin'), true);
      assert.equal(contract.roleCanAccessRoute(route, 'team_lead'), false);
      assert.equal(contract.roleCanAccessRoute(route, 'bd_user'), false);
    }

    const operations = contract.resolveRuntimeRoute('/operations', 'GET');
    assert(operations);
    assert.equal(contract.roleCanAccessRoute(operations, 'admin'), true);
    assert.equal(contract.roleCanAccessRoute(operations, 'team_lead'), true);
    assert.equal(contract.roleCanAccessRoute(operations, 'bd_user'), true);

    const failure = contract.runtimeFailureDetails(new Error('private database detail must not be exposed'), 'route_contract_test');
    const jsonFailure = contract.runtimeErrorResponse(new Request('https://local.invalid/prospects', { headers: { accept: 'application/json' } }), failure);
    assert.equal(jsonFailure.status, 500);
    assert.equal(jsonFailure.headers.get('x-runtime-reference'), failure.referenceId);
    const jsonBody = await jsonFailure.text();
    assert.equal(jsonBody.includes('private database detail'), false);
    assert.equal(jsonBody.includes(failure.referenceId), true);

    const htmlFailure = contract.runtimeErrorResponse(new Request('https://local.invalid/prospects', { headers: { accept: 'text/html' } }), failure);
    const htmlBody = await htmlFailure.text();
    assert.equal(htmlBody.includes('private database detail'), false);
    assert.equal(htmlBody.includes(failure.referenceId), true);

    console.log(`Protected route contract verified for ${contract.runtimeRouteContracts.length} route entries and ${dedicatedHandlers.length} dedicated handlers`);
  } finally {
    restoreEnvironment(originalEnvironment);
  }
}

function moduleHandler(module: unknown): { fetch(request: Request): Promise<Response> } {
  const first = (module as { default?: unknown }).default;
  const candidate = (first as { default?: unknown } | undefined)?.default ?? first;
  assert(candidate && typeof (candidate as { fetch?: unknown }).fetch === 'function', 'runtime module must expose a fetch handler');
  return candidate as { fetch(request: Request): Promise<Response> };
}

function restoreEnvironment(originalEnvironment: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnvironment)) delete process.env[key];
  }
  Object.assign(process.env, originalEnvironment);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
