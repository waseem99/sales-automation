import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const repoRoot = path.resolve("../..");
const rootPackage = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "packages/campaign-engine/package.json"), "utf8"));
const engine = fs.readFileSync(path.join(repoRoot, "packages/campaign-engine/src/index.ts"), "utf8");
const engineTests = fs.readFileSync(path.join(repoRoot, "packages/campaign-engine/src/index.test.ts"), "utf8");
const runtime = fs.readFileSync(path.join(repoRoot, "vercel/acquisition-campaign-runtime.ts"), "utf8");
const endpoint = fs.readFileSync(path.join(repoRoot, "api/acquisition-ingest.ts"), "utf8");
const catalogue = fs.readFileSync(path.join(repoRoot, "workers/acquisition/extensions/linkedin/sales-nav-catalogue.js"), "utf8");
const options = fs.readFileSync(path.join(repoRoot, "workers/acquisition/extensions/linkedin/sales-nav-options.js"), "utf8");
const persistence = fs.readFileSync(path.join(repoRoot, "workers/acquisition/extensions/linkedin/sales-nav-options-persist.js"), "utf8");
const optionsHtml = fs.readFileSync(path.join(repoRoot, "workers/acquisition/extensions/linkedin/sales-nav-options.html"), "utf8");
const backgroundEntry = fs.readFileSync(path.join(repoRoot, "workers/acquisition/extensions/linkedin/background-entry.js"), "utf8");

for (const [name, source] of Object.entries({catalogue, options, persistence, backgroundEntry})) {
  assert.doesNotThrow(() => new vm.Script(source), `${name} must parse as JavaScript`);
}

assert.equal(rootPackage.dependencies["@sales-automation/campaign-engine"], "workspace:*");
assert.equal(packageJson.name, "@sales-automation/campaign-engine");
assert.equal(packageJson.scripts.test, "tsx src/index.test.ts");

for (const marker of [
  "CAMPAIGN_ENGINE_VERSION = 'offer-campaign-engine.v1'",
  "fintech_operations_platform",
  "managed_software_ai_delivery",
  "fintech_direct_buyers",
  "fintech_channel_partners",
  "software_ai_overflow_partners",
  "direct_buyer",
  "channel_partner",
  "delivery_partner",
  "on_hold",
  "retired",
  "noBuyerIntentWarning",
  "explicitBuyerIntentConfirmed",
  "ICP-based hypothesis",
  "humanReviewRequired: true",
  "validatePortfolio",
  "migrateLegacySalesNavigatorCampaign"
]) assert(engine.includes(marker), `campaign engine missing marker: ${marker}`);

for (const marker of [
  "no buying intent is confirmed",
  "route, 'channel_partner'",
  "route, 'delivery_partner'",
  "state, 'on_hold'",
  "missing offer",
  "campaignEngineVersion"
]) assert(engineTests.includes(marker), `campaign tests missing marker: ${marker}`);

for (const marker of [
  "applyCampaignEngineAfterIntake",
  "matchLeadToCampaigns",
  "attachCampaignMatches",
  "validatePortfolio",
  "coldHypotheses",
  "explicitBuyerIntentConfirmed",
  "externalActionAutomated: false",
  "humanReviewRequired: true",
  "campaign matching was deferred"
]) assert(runtime.includes(marker), `campaign runtime missing marker: ${marker}`);

const identityInvocation = endpoint.indexOf("const identityResponse = await applyIdentityGraphAfterIntake");
const enrichmentInvocation = endpoint.indexOf("const enrichmentResponse = await applyEnrichmentAfterIntake");
const campaignInvocation = endpoint.indexOf("return applyCampaignEngineAfterIntake");
assert(identityInvocation >= 0 && enrichmentInvocation > identityInvocation && campaignInvocation > enrichmentInvocation, "intake order must be source → identity → enrichment → campaign");
assert(endpoint.includes("response: enrichmentResponse"));

for (const marker of [
  "offer-campaign-catalogue-v1",
  "fintech_direct_buyers",
  "fintech_channel_partners",
  "software_ai_overflow_partners",
  "fintech_backend_operations_legacy",
  "superseded_by",
  "state: \"on_hold\"",
  "search_urls: []"
]) assert(catalogue.includes(marker), `browser catalogue missing marker: ${marker}`);

assert(backgroundEntry.includes('"sales-nav-catalogue.js"'));
assert(backgroundEntry.indexOf('"sales-nav-catalogue.js"') < backgroundEntry.indexOf('"sales-nav-background.js"'));
for (const marker of [
  "campaignSelect",
  "newCampaignId",
  "Create campaign",
  "Duplicate selected campaign",
  "campaignRoute",
  "direct_buyer",
  "channel_partner",
  "delivery_partner",
  "Campaign active",
  "Positive campaign terms",
  "No automatic outreach"
]) assert(optionsHtml.includes(marker), `campaign options UI missing marker: ${marker}`);

for (const marker of [
  "CODISTAN_GET_SALES_NAV_CAMPAIGNS",
  "CODISTAN_SAVE_SALES_NAV_CAMPAIGN",
  "CODISTAN_REGISTER_SALES_NAV_SEARCH",
  "CODISTAN_RUN_SALES_NAV_CAMPAIGNS_NOW",
  "research_only",
  "on_hold",
  "search_urls: []",
  "No explicit buying intent"
]) assert(options.includes(marker), `campaign options controller missing marker: ${marker}`);

for (const marker of [
  "codistan_sales_nav_campaigns",
  "campaignRoute",
  "offer_id",
  "target_company_types",
  "target_seniority",
  "positive_terms",
  "search_urls: list(existing.search_urls)"
]) assert(persistence.includes(marker), `campaign persistence guard missing marker: ${marker}`);

const prohibited = [
  ".click(",
  "sendMessageToProspect",
  "sendEmail",
  "submitProposal",
  "connectToLead",
  "automaticMergePerformed: true",
  "externalActionAutomated: true"
];
for (const marker of prohibited) {
  assert(!catalogue.toLowerCase().includes(marker.toLowerCase()), `catalogue contains prohibited marker: ${marker}`);
  assert(!runtime.toLowerCase().includes(marker.toLowerCase()), `campaign runtime contains prohibited marker: ${marker}`);
}

console.log("Campaign engine bridge contract passed.");
