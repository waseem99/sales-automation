import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repositoryRoot = path.resolve("../..");
const api = fs.readFileSync(path.join(repositoryRoot, "api/acquisition-ingest.ts"), "utf8");
const runtime = fs.readFileSync(path.join(repositoryRoot, "vercel/acquisition-intake-runtime.ts"), "utf8");
const vercelConfig = JSON.parse(fs.readFileSync(path.join(repositoryRoot, "vercel.json"), "utf8"));
const sync = fs.readFileSync(path.join(repositoryRoot, "workers/acquisition/acquisition_v4/sync.py"), "utf8");
const collector = fs.readFileSync(path.join(repositoryRoot, "workers/acquisition/acquisition_v4/runtime.py"), "utf8");
const installer = fs.readFileSync(path.join(repositoryRoot, "workers/acquisition/scripts/windows/install-acquisition-v4.ps1"), "utf8");
const configure = fs.readFileSync(path.join(repositoryRoot, "workers/acquisition/scripts/windows/configure-prospect-desk-sync.ps1"), "utf8");

assert.deepEqual(vercelConfig.functions["api/acquisition-ingest.ts"], {maxDuration: 300});

for (const marker of [
  "ACQUISITION_INGEST_TOKEN",
  "timingSafeEqual",
  "createHash('sha256')",
  "request.method !== 'POST'",
  "MAX_REQUEST_BYTES = 1_000_000",
  "Bearer",
  "DATABASE_URL",
  "handleAcquisitionIntake"
]) assert(api.includes(marker), `missing acquisition API safeguard: ${marker}`);

for (const marker of [
  "codistan-acquisition-sync.v1",
  "loadNeonAppState",
  "persistLeadRecords",
  "evaluateLead",
  "applyAutomaticAssignment",
  "buildOwnerWorkload",
  "applyFirstOutreachGuidance",
  "linkedin_warm_post",
  "partner_prospect",
  "website_portal",
  "ar_3d_unity_unreal",
  "cybersecurity_compliance",
  "fullstack_web_app",
  "recommendedProfile",
  "recommendedPortfolioItemIds",
  "draftMessage",
  "externalActionAutomated: false",
  "humanReviewRequired: true",
  "mergeIncomingLead",
  "lastContactedAt: existing.lastContactedAt",
  "lastResponseAt: existing.lastResponseAt",
  "owner: existing.owner"
]) assert(runtime.includes(marker), `missing Prospect Desk mapping marker: ${marker}`);

for (const marker of [
  "ProspectDeskSync",
  "prospect-desk-sync.json",
  "Authorization",
  "Bearer",
  "MAX_BATCH_RECORDS = 25",
  "qualification.get(\"disposition\") == \"reject\"",
  "_record_fingerprint",
  "Prospect Desk sync endpoint is unreachable",
  "last_success_at",
  "endpoint_host"
]) assert(sync.includes(marker), `missing local sync marker: ${marker}`);
assert(!sync.includes('self._status["token"]'));
assert(!sync.includes("config.token[:"));

for (const marker of [
  "ProspectDeskSync",
  "prospect_desk_sync.notify()",
  '"prospect_desk_sync": self.prospect_desk_sync.health()'
]) assert(collector.includes(marker), `missing collector sync integration: ${marker}`);

for (const marker of [
  "Configure Prospect Desk Sync.lnk",
  "prospect-desk-sync.json",
  'enabled = $false',
  'sources = @(\"linkedin\")'
]) assert(installer.includes(marker), `missing installer sync marker: ${marker}`);

for (const marker of [
  "/api/acquisition-ingest",
  "ACQUISITION_INGEST_TOKEN",
  "Read-Host $Prompt -AsSecureString",
  "Token: stored locally and not printed",
  'sources = @(\"linkedin\")'
]) assert(configure.includes(marker), `missing secure sync configuration marker: ${marker}`);
assert(!configure.includes("Write-Host $Token"));

for (const prohibited of [
  "sendEmail(",
  "sendMessage(",
  "connectLinkedIn",
  "submitProposal",
  "externalActionAutomated: true",
  "external_action_performed\": True"
]) {
  assert(!`${api}\n${runtime}\n${sync}`.includes(prohibited), `bridge contains prohibited action: ${prohibited}`);
}

console.log("Prospect Desk acquisition bridge contract passed.");
