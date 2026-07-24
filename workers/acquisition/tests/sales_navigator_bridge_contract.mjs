import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repositoryRoot = path.resolve("../..");
const api = fs.readFileSync(path.join(repositoryRoot, "api/acquisition-ingest.ts"), "utf8");
const intake = fs.readFileSync(path.join(repositoryRoot, "vercel/sales-navigator-intake-runtime.ts"), "utf8");
const workspace = fs.readFileSync(path.join(repositoryRoot, "vercel/workspace-page-model.ts"), "utf8");
const navigation = fs.readFileSync(path.join(repositoryRoot, "vercel/workspace-pages.ts"), "utf8");
const vercel = JSON.parse(fs.readFileSync(path.join(repositoryRoot, "vercel.json"), "utf8"));
const configure = fs.readFileSync(path.join(repositoryRoot, "workers/acquisition/scripts/windows/configure-prospect-desk-sync.ps1"), "utf8");
const installer = fs.readFileSync(path.join(repositoryRoot, "workers/acquisition/scripts/windows/install-acquisition-v4.ps1"), "utf8");
const supervisor = fs.readFileSync(path.join(repositoryRoot, "workers/acquisition/acquisition_v4/supervisor.py"), "utf8");

assert(api.includes("handleSalesNavigatorIntake"));
assert(api.includes("source === 'sales_navigator'"));

for (const marker of [
  "source: 'sales_navigator'",
  "leadType: 'sales_navigator_cold_prospect'",
  "prospectStage: 'cold_prospect'",
  "buyerIntentConfirmed: false",
  "externalActionAutomated: false",
  "opportunityStatus: undefined",
  "Sales Navigator cold campaign",
  "campaign",
  "applyAutomaticAssignment",
  "applyFirstOutreachGuidance",
  "recommendedProfile",
  "recommendedPortfolioItemIds",
  "draftMessage",
  "lastContactedAt: existing.lastContactedAt",
  "lastResponseAt: existing.lastResponseAt",
  "owner: existing.owner",
  "/leads/sales-navigator",
]) assert(intake.includes(marker), `missing Sales Navigator intake marker: ${marker}`);

for (const marker of [
  "'sales_navigator'",
  "'/leads/sales-navigator'",
  "'sales_navigator_cold_prospect'",
  "'cold_prospect'",
  "no explicit buying intent",
]) assert(workspace.includes(marker), `missing cold workspace marker: ${marker}`);

assert(navigation.includes("Sales Navigator prospects"));
assert(navigation.includes("Cold campaigns"));
assert(vercel.rewrites.some((rewrite) => rewrite.source === "/leads/sales-navigator"));
assert(configure.includes('@("linkedin", "upwork", "sales_navigator")'));
assert(installer.includes('@("linkedin", "upwork", "sales_navigator")'));
assert(installer.includes("8765,8775,8785"));
assert(supervisor.includes('"sales_navigator": 8785'));

const combined = `${api}\n${intake}`.toLowerCase();
for (const prohibited of [
  "sendemail(", "sendmessage(", "connectlinkedin", "submitproposal", "externalactionautomated: true",
]) assert(!combined.includes(prohibited.toLowerCase()), `Sales Navigator bridge contains prohibited action: ${prohibited}`);

console.log("Sales Navigator Prospect Desk bridge contract passed.");
