import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve("extensions/linkedin");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const background = fs.readFileSync(path.join(root, "background.js"), "utf8");
const adapter = fs.readFileSync(path.join(root, "dom-adapter.js"), "utf8");
const resolver = fs.readFileSync(path.join(root, "search-resolver.js"), "utf8");
const content = fs.readFileSync(path.join(root, "content.js"), "utf8");
const popup = fs.readFileSync(path.join(root, "popup.js"), "utf8");
const popupHtml = fs.readFileSync(path.join(root, "popup.html"), "utf8");
const signalSource = fs.readFileSync(path.join(root, "signal.js"), "utf8");

assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.version, "1.3.0");
assert(background.includes('linkedin-extension-1.3.0'));
assert(background.includes("records.slice(0, MAX_RECORDS)"));
assert.deepEqual(manifest.content_scripts[0].js, ["signal.js", "dom-adapter.js", "search-resolver.js", "content.js"]);
assert(manifest.permissions.includes("scripting"));
assert(manifest.permissions.includes("alarms"));
assert(manifest.host_permissions.includes("http://127.0.0.1:8775/*"));

for (const marker of [
  'source: "linkedin"',
  'external_action_performed: false',
  'source_subtype: "content_search_post"',
  'parser_version: PARSER_VERSION'
]) assert(background.includes(marker), `missing payload marker: ${marker}`);

for (const marker of [
  'SCHEDULE_INTERVAL_MINUTES = 15',
  'SCHEDULE_ALARM = "codistan_linkedin_approved_search_cycle"',
  'chrome.alarms.create',
  'chrome.alarms.onAlarm',
  'delayInMinutes: 1',
  'periodInMinutes: SCHEDULE_INTERVAL_MINUTES',
  'scheduled_15_minute_search_cycle',
  'manual_run_all_searches',
  'chrome.tabs.create({url: search.url, active: false})',
  'chrome.tabs.remove(tabId)',
  'if (scheduledRun) return scheduledRun',
  'CODISTAN_RUN_LINKEDIN_SCHEDULED_SCAN_NOW',
  'CODISTAN_GET_LINKEDIN_AUTOMATION_STATUS',
  'CODISTAN_SET_LINKEDIN_AUTOMATION',
  'linkedin.com\\/(?:login|checkpoint|authwall)'
]) assert(background.includes(marker), `missing scheduled LinkedIn marker: ${marker}`);

for (const searchId of [
  'id: "software_delivery"',
  'id: "ai_automation"',
  'id: "digital_marketing"',
  'id: "creative_delivery"',
  'id: "cybersecurity"'
]) assert(background.includes(searchId), `missing approved LinkedIn search: ${searchId}`);
assert.equal((background.match(/\bid: "(?:software_delivery|ai_automation|digital_marketing|creative_delivery|cybersecurity)"/g) || []).length, 5);

for (const marker of [
  'data-codistan-opportunity-card="true"',
  'looseActivityUrn',
  'nodeAttributeValues',
  'candidate_urls',
  'containers_with_activity_id',
  'containers_with_permalink_hint',
  'missing_canonical_url',
  'linkedin-dom-1.1.0'
]) assert(content.includes(marker), `missing LinkedIn DOM marker: ${marker}`);

for (const marker of [
  "data-codistan-opportunity-card",
  "nearestCardFromActor",
  "distinctActorHrefs",
  "pruneNestedCards",
  "activityEvidence",
  "removeAttribute(MARKER)",
  "MutationObserver"
]) assert(adapter.includes(marker), `missing LinkedIn adapter marker: ${marker}`);
assert(!adapter.includes('setAttribute("data-view-name", "feed-full-update")'));

for (const marker of [
  'data-codistan-canonical-url',
  'spatialCardLink',
  'canonicalAnchors',
  'renderedRect',
  'canonicalFromElement',
  'scrollCandidates',
  'currentScrollStatus',
  'scroller_kind',
  'CODISTAN_RESOLVE_LINKEDIN_LINKS',
  'CODISTAN_SCROLL_LINKEDIN_RESULTS',
  'CODISTAN_RESTORE_LINKEDIN_SCROLL',
  'window.scrollTo',
  '/search/results/content',
  'DEFAULT_WAIT_MS = 2500',
  'MAX_WAIT_MS = 4000'
]) assert(resolver.includes(marker), `missing LinkedIn resolver marker: ${marker}`);

for (const marker of [
  'id="automationEnabled"',
  'Run all five approved searches every 15 minutes',
  'id="runScheduled"',
  'Run all approved searches now',
  'id="automationStatus"',
  'id="scanMore"',
  'Scan and load more results'
]) assert(popupHtml.includes(marker), `missing LinkedIn popup control: ${marker}`);

for (const marker of [
  'MAX_SCROLL_STEPS = 4',
  'MAX_RECORDS = 30',
  'SCROLL_WAIT_MS = 2500',
  'manual_bounded_scroll_scan',
  'CODISTAN_RESOLVE_LINKEDIN_LINKS',
  'CODISTAN_LINKEDIN_SCROLL_STATUS',
  'CODISTAN_SCROLL_LINKEDIN_RESULTS',
  'CODISTAN_RESTORE_LINKEDIN_SCROLL',
  'scroll container',
  'no_movable_scroll_container',
  'chrome.scripting.executeScript',
  'CONTENT_SCRIPT_FILES',
  'missingReceiver',
  'Repairing the tab and retrying',
  'CODISTAN_GET_LINKEDIN_AUTOMATION_STATUS',
  'CODISTAN_SET_LINKEDIN_AUTOMATION',
  'CODISTAN_RUN_LINKEDIN_SCHEDULED_SCAN_NOW'
]) assert(popup.includes(marker), `missing bounded/scheduled scan marker: ${marker}`);

const prohibited = [
  "chrome.tabs.update", "scrollIntoView",
  ".click(", "dispatchEvent", "navigator.webdriver", "Math.random", "captcha", "cloudflare",
  "chrome.runtime.sendMessage({type: \"CONNECT\"", "chrome.notifications",
  "send message", "connection request", "auto dm", "automated dm"
];
for (const marker of prohibited) {
  for (const [name, source] of Object.entries({background, adapter, resolver, content, popup})) {
    assert(!source.toLowerCase().includes(marker.toLowerCase()), `${name} contains prohibited marker: ${marker}`);
  }
}
assert(!background.includes("window.scrollTo"));
assert(!adapter.includes("window.scrollTo"));
assert(!content.includes("window.scrollTo"));
assert(!popup.includes("window.scrollTo"));

const context = {URL, decodeURIComponent, globalThis: {}};
vm.createContext(context);
vm.runInContext(signalSource, context);
const helper = context.globalThis.CodistanLinkedInSignal;
assert(helper);

const direct = helper.classifyOpportunity(
  "We are looking for a digital marketing agency for social media management, content and paid ads. Please send your proposal."
);
assert.equal(direct.candidate, true);
assert(direct.service_lanes.includes("digital_growth"));
assert(direct.contact_routes.includes("proposal"));

const software = helper.classifyOpportunity(
  "Seeking an implementation partner to build an AI automation platform and private RAG workflow."
);
assert.equal(software.candidate, true);
assert(software.service_lanes.includes("software"));
assert(software.service_lanes.includes("ai_automation"));

const serviceProviders = helper.classifyOpportunity(
  "Seeking IT Service Providers and Development Partners. We are accelerating a fraud analytics portal for finance companies."
);
assert.equal(serviceProviders.candidate, true);
assert(serviceProviders.service_lanes.includes("software"));

const projectNetwork = helper.classifyOpportunity(
  "Calling Cybersecurity Freelancers & Independent Consultants! We are expanding our network for upcoming freelance and project-based engagements. Please reach out."
);
assert.equal(projectNetwork.candidate, true);
assert(projectNetwork.service_lanes.includes("cybersecurity"));
assert(projectNetwork.contact_routes.includes("direct_message"));

const videoAgency = helper.classifyOpportunity(
  "Looking for an AI video production agency! Need a team that can move fast and produce long-form branded videos."
);
assert.equal(videoAgency.candidate, true);
assert(videoAgency.service_lanes.includes("creative_animation"));
assert(videoAgency.service_lanes.includes("ai_automation"));

const vacancy = helper.classifyOpportunity(
  "We are hiring a full-time senior software engineer. Apply now and send your CV."
);
assert.equal(vacancy.candidate, false);
assert.equal(vacancy.reject_reason, "permanent_vacancy");

const seeker = helper.classifyOpportunity(
  "I am open to work and looking for opportunities as a digital marketing specialist. Here is my portfolio."
);
assert.equal(seeker.candidate, false);
assert.equal(seeker.reject_reason, "job_seeker_or_self_promotion");

assert.equal(
  helper.activityUrnFromValue("urn%253Ali%253Aactivity%253A1234567890123456789"),
  "urn:li:activity:1234567890123456789"
);
assert.equal(
  helper.activityUrnFromValue("https://www.linkedin.com/posts/example-topic-activity-1234567890123456789-abcd"),
  "urn:li:activity:1234567890123456789"
);
assert.equal(
  helper.canonicalPostUrl("", "urn:li:activity:1234567890123456789"),
  "https://www.linkedin.com/feed/update/urn:li:activity:1234567890123456789"
);

console.log("LinkedIn extension contract passed.");
