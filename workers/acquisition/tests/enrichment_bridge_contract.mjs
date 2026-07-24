import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve("../..");
const rootPackage = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "packages/enrichment/package.json"), "utf8"));
const source = fs.readFileSync(path.join(repoRoot, "packages/enrichment/src/index.ts"), "utf8");
const publicSource = fs.readFileSync(path.join(repoRoot, "packages/enrichment/src/public.ts"), "utf8");
const tests = fs.readFileSync(path.join(repoRoot, "packages/enrichment/src/index.test.ts"), "utf8");
const runtime = fs.readFileSync(path.join(repoRoot, "vercel/acquisition-enrichment-runtime.ts"), "utf8");
const endpoint = fs.readFileSync(path.join(repoRoot, "api/acquisition-ingest.ts"), "utf8");

assert.equal(rootPackage.dependencies["@sales-automation/enrichment"], "workspace:*");
assert.equal(packageJson.name, "@sales-automation/enrichment");
assert.equal(packageJson.main, "dist/public.js");
assert.equal(packageJson.scripts.test, "tsx src/index.test.ts");

for (const marker of [
  "ENRICHMENT_VERSION = 'evidence-enrichment.v1'",
  "source_visible",
  "public_web",
  "provider_discovered",
  "verified",
  "human_confirmed",
  "system_inference",
  "source_visible_only",
  "credentialsExposed: false",
  "VerificationStatus",
  "ContactabilityStatus",
  "EnrichmentTask",
  "verify_business_email",
  "find_company_domain",
  "find_alternate_decision_maker",
  "verify_relationship_path",
  "Do not infer or use an off-platform route",
  "externalActionPerformed: false",
  "EnrichmentProviderAdapter"
]) assert(source.includes(marker), `enrichment package missing marker: ${marker}`);

for (const marker of [
  "suppression.suppressed",
  "status: 'suppressed' as const",
  "tasks: []",
  "contactability: 'suppressed'"
]) assert(publicSource.includes(marker), `suppression-safe public API missing marker: ${marker}`);

for (const marker of [
  "verificationStatus, 'candidate'",
  "verificationStatus, 'verified'",
  "providerMode.mode, 'source_visible_only'",
  "status, 'platform_restricted'",
  "suppression.suppressed, true",
  "provenance, 'human_confirmed'",
  "snapshot.person.email, undefined"
]) assert(tests.includes(marker), `enrichment tests missing scenario marker: ${marker}`);

for (const marker of [
  "applyEnrichmentAfterIntake",
  "buildEvidenceBasedEnrichment",
  "readEnrichmentSnapshot",
  "enrichmentStateEqual",
  "loadNeonAppState",
  "persistLeadRecords",
  "Source ingestion succeeded, but evidence enrichment was deferred",
  "providerMode: 'source_visible_only'",
  "activeProviders: []",
  "externalActionAutomated: false",
  "humanReviewRequired: true"
]) assert(runtime.includes(marker), `enrichment runtime missing marker: ${marker}`);

const identityInvocation = endpoint.indexOf("const identityResponse = await applyIdentityGraphAfterIntake");
const enrichmentInvocation = endpoint.indexOf("return applyEnrichmentAfterIntake");
assert(identityInvocation >= 0 && enrichmentInvocation > identityInvocation, "identity must execute before enrichment");
assert(endpoint.includes("response: identityResponse"));
assert(endpoint.includes("databaseUrl"));

const prohibited = [
  "externalActionAutomated: true",
  "credentialsExposed: true",
  "sendEmail",
  "sendMessage",
  "submitProposal",
  "automatic outreach",
  "fabricated email"
];
for (const marker of prohibited) {
  assert(!source.toLowerCase().includes(marker.toLowerCase()), `enrichment source contains prohibited marker: ${marker}`);
  assert(!runtime.toLowerCase().includes(marker.toLowerCase()), `enrichment runtime contains prohibited marker: ${marker}`);
}

console.log("Evidence enrichment bridge contract passed.");
