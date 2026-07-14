import assert from 'node:assert/strict';
import type { PortfolioItem } from '@sales-automation/shared';
import { asPortfolioItems, replacePortfolioArray, type ManagedPortfolioItem } from './portfolio-catalog.js';

const item: ManagedPortfolioItem = {
  id: 'approved-proof',
  projectName: 'Approved proof',
  confidentiality: 'public',
  serviceCategories: ['fullstack_web_app'],
  techStack: ['React'],
  problemSolved: 'A buyer needed a web application delivery partner.',
  assetUrls: ['https://example.com/proof'],
  tags: ['web application'],
  bestProfiles: ['codistan_partner_identity'],
  approvalStatus: 'approved',
  approvedBy: 'waseem@codistan.org',
  approvedAt: '2026-07-15T00:00:00.000Z',
  approvedProofStatement: 'Approved and evidence-based proof statement.',
  assetHealth: 'available',
  createdAt: '2026-07-15T00:00:00.000Z',
  updatedAt: '2026-07-15T00:00:00.000Z',
};

const converted = asPortfolioItems([item]);
assert.equal(converted.length, 1);
assert.equal(converted[0]?.id, item.id);

const target: PortfolioItem[] = [{ ...item, id: 'old-proof', projectName: 'Old proof' }];
replacePortfolioArray(target, converted);
assert.deepEqual(target.map((entry) => entry.id), ['approved-proof']);

console.log('Managed portfolio catalog helper tests passed');
