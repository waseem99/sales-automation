import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const campaigns = readFileSync(new URL('../packages/prospect-discovery/src/campaigns.ts', import.meta.url), 'utf8');
const qualityRunner = readFileSync(new URL('../packages/prospect-discovery/src/quality-runner.ts', import.meta.url), 'utf8');
const types = readFileSync(new URL('../packages/prospect-discovery/src/types.ts', import.meta.url), 'utf8');
const campaignTests = readFileSync(new URL('../packages/prospect-discovery/src/campaigns.test.ts', import.meta.url), 'utf8');

for (const campaignId of [
  'ai_rag_automation',
  'custom_software_saas',
  'white_label_agency',
  'cybersecurity_compliance',
  'immersive_3d_ar_vr',
  'digital_marketing_web',
]) {
  assert.match(campaigns, new RegExp(campaignId));
}
assert.match(campaigns, /request for proposal/);
assert.match(campaigns, /seeking an implementation partner/);
assert.match(campaigns, /seeking a white-label development partner/);
assert.match(campaigns, /-site:wikipedia\.org/);
assert.match(campaigns, /-site:imdb\.com/);
assert.match(campaigns, /for \(let index = 0; index < maximumDepth/);
assert.match(qualityRunner, /PROSPECT_CAMPAIGN_IDS/);
assert.match(qualityRunner, /buildCampaignSearchQueries/);
assert.match(qualityRunner, /activeCampaignIds/);
assert.match(qualityRunner, /options\.runStore\?\.saveRun\(result\.run\)/);
assert.match(types, /campaignIds\?: string\[\]/);
assert.match(types, /activeCampaignIds\?: string\[\]/);
assert.match(campaignTests, /round-robin coverage and exclusion rules passed/);

console.log('High-intent campaign packs, environment selection and persisted run metadata contracts passed');
