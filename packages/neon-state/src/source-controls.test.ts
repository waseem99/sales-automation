import assert from 'node:assert/strict';
import { isDiscoverySourceKey, sourceControlMap, type DiscoverySourceControl } from './source-controls.js';

const controls: DiscoverySourceControl[] = [
  { sourceKey: 'bing_rss', enabled: true, reason: 'Approved source', updatedBy: 'admin', updatedAt: '2026-07-15T00:00:00.000Z' },
  { sourceKey: 'remoteok', enabled: false, reason: 'Employment source disabled', updatedBy: 'admin', updatedAt: '2026-07-15T00:00:00.000Z' },
  { sourceKey: 'upwork_saved_search_inbox', enabled: true, reason: 'Approved saved-search inbox', updatedBy: 'admin', updatedAt: '2026-07-15T00:00:00.000Z' },
];
const mapped = sourceControlMap(controls);
assert.equal(mapped.bing_rss, true);
assert.equal(mapped.remoteok, false);
assert.equal(mapped.upwork_saved_search_inbox, true);
assert.equal(isDiscoverySourceKey('canadabuys'), true);
assert.equal(isDiscoverySourceKey('upwork_saved_search_inbox'), true);
assert.equal(isDiscoverySourceKey('unknown'), false);

console.log('Discovery source control helper tests passed');
