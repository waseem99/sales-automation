import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve("../..");
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const identityPackage = JSON.parse(fs.readFileSync(path.join(repoRoot, "packages/identity-graph/package.json"), "utf8"));
const identitySource = fs.readFileSync(path.join(repoRoot, "packages/identity-graph/src/index.ts"), "utf8");
const identityTests = fs.readFileSync(path.join(repoRoot, "packages/identity-graph/src/index.test.ts"), "utf8");
const intakeStage = fs.readFileSync(path.join(repoRoot, "vercel/acquisition-identity-runtime.ts"), "utf8");
const endpoint = fs.readFileSync(path.join(repoRoot, "api/acquisition-ingest.ts"), "utf8");

assert.equal(packageJson.dependencies["@sales-automation/identity-graph"], "workspace:*");
assert.equal(identityPackage.name, "@sales-automation/identity-graph");
assert.equal(identityPackage.scripts.test, "tsx src/index.test.ts");

for (const marker of [
  "IDENTITY_GRAPH_VERSION = 'identity-graph.v1'",
  "resolveLeadIdentity",
  "attachIdentityResolution",
  "readIdentityResolution",
  "duplicateContactWarning",
  "linkedin_profile",
  "sales_navigator_profile",
  "business_email",
  "company_domain",
  "name_company_role",
  "status: 'candidate'",
  "status: 'conflict'",
  "automaticMergePerformed: false",
  "Do not merge automatically"
]) assert(identitySource.includes(marker), `identity graph missing marker: ${marker}`);

for (const marker of [
  "https://www.linkedin.com/in/muskan-vig/",
  "partner@example.com",
  "status, 'candidate'",
  "companyWebsite",
  "status, 'conflict'",
  "automaticMergePerformed, false"
]) assert(identityTests.includes(marker), `identity tests missing scenario marker: ${marker}`);

for (const marker of [
  "applyIdentityGraphAfterIntake",
  "processedLeadIds",
  "loadNeonAppState",
  "persistLeadRecords",
  "resolveLeadIdentity",
  "duplicateContactWarning",
  "identity_graph::candidate_person",
  "identity_graph::candidate_company",
  "identity_graph::conflict",
  "externalActionAutomated: false",
  "humanReviewRequired: true"
]) assert(intakeStage.includes(marker), `post-intake identity stage missing marker: ${marker}`);

assert(endpoint.includes("applyIdentityGraphAfterIntake"));
assert(endpoint.includes("const intakeResponse = await handler"));
assert(endpoint.includes("response: intakeResponse"));
assert(endpoint.includes("databaseUrl"));

const prohibited = [
  "deleteLeadRecords",
  "DELETE FROM prospect_records",
  "automaticMergePerformed: true",
  "externalActionAutomated: true",
  "sendEmail",
  "sendMessage",
  "connect(",
  "inmail"
];
for (const marker of prohibited) {
  assert(!identitySource.toLowerCase().includes(marker.toLowerCase()), `identity graph contains prohibited marker: ${marker}`);
  assert(!intakeStage.toLowerCase().includes(marker.toLowerCase()), `identity stage contains prohibited marker: ${marker}`);
}

console.log("Identity graph bridge contract passed.");
