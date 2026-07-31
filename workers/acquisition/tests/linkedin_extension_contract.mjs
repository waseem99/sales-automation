import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve("extensions/linkedin");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const entry = fs.readFileSync(path.join(root, "background-entry.js"), "utf8");
const background = fs.readFileSync(path.join(root, "background.js"), "utf8");
const hardening = fs.readFileSync(path.join(root, "parser-hardening.js"), "utf8");
const adapter = fs.readFileSync(path.join(root, "dom-adapter.js"), "utf8");
const resolver = fs.readFileSync(path.join(root, "search-resolver.js"), "utf8");
const content = fs.readFileSync(path.join(root, "content.js"), "utf8");
const salesNav = fs.readFileSync(path.join(root, "sales-nav.js"), "utf8");
const popup = fs.readFileSync(path.join(root, "popup.js"), "utf8");
const popupHtml = fs.readFileSync(path.join(root, "popup.html"), "utf8");
const signalSource = fs.readFileSync(path.join(root, "signal.js"), "utf8");

assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.version, "1.6.1");
assert.deepEqual([...manifest.permissions].sort(), ["alarms", "scripting", "storage", "tabs"]);
assert(!manifest.permissions.includes("activeTab"));
assert(entry.includes("background.js"));
assert(entry.includes("sales-nav-catalogue.js"));
assert(entry.includes("sales-nav-background.js"));
assert(background.includes("linkedin-extension-1.3.0"));
assert(background.includes("records.slice(0, MAX_RECORDS)"));
assert.deepEqual(manifest.content_scripts[0].js, ["parser-hardening.js", "signal.js", "dom-adapter.js", "search-resolver.js", "content.js"]);
assert.deepEqual(manifest.content_scripts[1].js, ["parser-hardening.js", "sales-nav.js"]);
assert(manifest.permissions.includes("scripting"));
assert(manifest.permissions.includes("alarms"));
assert(manifest.host_permissions.includes("http://127.0.0.1:8775/*"));

for (const marker of [
  'source: "linkedin"',
  'external_action_performed: false',
  'source_subtype: "content_search_post"',
  'parser_version: PARSER_VERSION',
  'SCHEDULE_INTERVAL_MINUTES = 15',
  'chrome.alarms.create',
  'chrome.alarms.onAlarm',
  'scheduled_15_minute_search_cycle',
  'manual_run_all_searches',
  'chrome.tabs.create({url: search.url, active: false})',
  'chrome.tabs.remove(tabId)',
  'if (scheduledRun) return scheduledRun',
  'CODISTAN_RUN_LINKEDIN_SCHEDULED_SCAN_NOW',
  'CODISTAN_GET_LINKEDIN_AUTOMATION_STATUS',
  'CODISTAN_SET_LINKEDIN_AUTOMATION',
]) assert(background.includes(marker), `missing warm LinkedIn marker: ${marker}`);

for (const searchId of [
  'id: "software_delivery"',
  'id: "ai_automation"',
  'id: "digital_marketing"',
  'id: "creative_delivery"',
  'id: "cybersecurity"',
]) assert(background.includes(searchId), `missing approved LinkedIn search: ${searchId}`);

for (const marker of [
  'data-codistan-opportunity-card="true"',
  'data-codistan-canonical-url',
  'canonicalPostUrl',
  'resolveVisibleCards',
  'CODISTAN_RESOLVE_LINKEDIN_LINKS',
]) assert(resolver.includes(marker), `missing search resolver marker: ${marker}`);

for (const marker of [
  'CODISTAN_SCROLL_LINKEDIN_RESULTS',
  'CODISTAN_RESTORE_LINKEDIN_SCROLL',
  'scrollCandidates',
  'scroller_candidates',
  'document.scrollingElement',
]) assert(resolver.includes(marker), `missing scroll resolver marker: ${marker}`);

for (const marker of [
  'CODISTAN_CAPTURE_VISIBLE_LINKEDIN_POSTS',
  'visible_post_containers',
  'classified_candidates',
  'candidate_urls',
  'containers_with_permalink_hint',
  'missing_canonical_url',
  'partial_parse_rejections',
  'layout_signature',
  'dom_mutations',
]) assert(content.includes(marker), `missing LinkedIn content marker: ${marker}`);

for (const marker of [
  'CODISTAN_CAPTURE_VISIBLE_SALES_NAVIGATOR_LEADS',
  'partial_parse_rejections',
  'layout_signature',
  'dom_mutations',
  'cold_no_confirmed_intent',
  'buyer_intent_confirmed: false',
]) assert(salesNav.includes(marker), `missing Sales Navigator hardening marker: ${marker}`);

for (const marker of [
  'linkedin-parser-hardening-1.0.0',
  'evaluateLinkedInRecord',
  'evaluateSalesNavigatorRecord',
  'dedupeRecords',
  'localizedAge',
  'layoutSignature',
  'createDomMonitor',
  'SENSITIVE_KEY',
]) assert(hardening.includes(marker), `missing parser hardening marker: ${marker}`);

assert(popup.includes("CODISTAN_RUN_LINKEDIN_SCHEDULED_SCAN_NOW"));
assert(popup.includes("CODISTAN_SET_LINKEDIN_AUTOMATION"));
assert(popup.includes("CODISTAN_GET_LINKEDIN_AUTOMATION_STATUS"));
assert(popupHtml.includes("Run all approved searches now"));
assert(popupHtml.includes("Run all five approved searches every 15 minutes"));
assert(signalSource.includes("classifyOpportunity"));
for (const marker of ["plausibleCard", "nearestCardFromActor", "annotate"]) {
  assert(adapter.includes(marker), `missing LinkedIn adapter marker: ${marker}`);
}

for (const source of [entry, background, hardening, adapter, resolver, content, salesNav, popup, signalSource]) {
  assert.doesNotThrow(() => new vm.Script(source));
}

const combined = `${background}\n${hardening}\n${adapter}\n${resolver}\n${content}\n${salesNav}\n${popup}`.toLowerCase();
for (const prohibited of [
  "navigator.webdriver", "dispatchevent", "captcha", "cloudflare",
  "sendlinkedinmessage(", "connectrequest(", "followlead(", "sendemail(",
  "external_action_performed: true", "external_action_automated: true", "chrome.tabs.update",
  "document.cookie", "chrome.cookies", "localstorage.getitem", "sessionstorage.getitem",
  "eval(", "new function(", "importscripts(\"http", "importscripts('http",
]) assert(!combined.includes(prohibited), `LinkedIn extension contains prohibited action, private-data or remote-code marker: ${prohibited}`);

assert(!resolver.includes("scrollIntoView"));
assert(!background.includes("chrome.tabs.update"));
assert(!background.includes("buyerIntentConfirmed: true"));

console.log("LinkedIn and Sales Navigator hardened capture extension contract passed.");
