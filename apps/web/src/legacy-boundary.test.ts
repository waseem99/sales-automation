import assert from 'node:assert/strict';
import { samplePortfolioItems } from '@sales-automation/fixtures';
import { InMemoryProspectDiscoveryRunStore } from '@sales-automation/prospect-discovery';
import { InMemoryLeadRepository } from '@sales-automation/storage';
import { handleProspectDashboardRequest } from './prospect-handler.js';

const context = {
  repository: new InMemoryLeadRepository(),
  portfolioItems: samplePortfolioItems,
  runStore: new InMemoryProspectDiscoveryRunStore(),
  adminPassword: 'strong-test-password',
  sessionSecret: 'strong-test-session-secret-123456789',
  secureCookies: false,
  now: () => '2026-07-14T16:00:00.000Z',
};

const login = await handleProspectDashboardRequest({
  method: 'POST',
  url: '/api/login',
  clientKey: 'legacy-boundary-test',
  body: { password: 'strong-test-password' },
}, context);

assert.equal(login.status, 200);
const cookie = login.headers['set-cookie']?.split(';')[0];
assert.ok(cookie?.startsWith('codistan_admin_session='));

const retiredPage = await handleProspectDashboardRequest({
  method: 'GET',
  url: '/lead-desk',
  headers: { cookie },
}, context);
assert.equal(retiredPage.status, 404);
assert.deepEqual(JSON.parse(retiredPage.body), { error: 'Not found.' });

const retiredApi = await handleProspectDashboardRequest({
  method: 'GET',
  url: '/api/opportunities',
  headers: { cookie },
}, context);
assert.equal(retiredApi.status, 404);
assert.deepEqual(JSON.parse(retiredApi.body), { error: 'Not found.' });

console.log('retired Lead Desk compatibility boundary tests passed');
