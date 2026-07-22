import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve("extensions/linkedin");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const background = fs.readFileSync(path.join(root, "background.js"), "utf8");
const content = fs.readFileSync(path.join(root, "content.js"), "utf8");
const signalSource = fs.readFileSync(path.join(root, "signal.js"), "utf8");

assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.version, "1.0.0");
assert.deepEqual(manifest.content_scripts[0].js, ["signal.js", "content.js"]);
assert(manifest.host_permissions.includes("http://127.0.0.1:8775/*"));

for (const marker of [
  'source: "linkedin"',
  'external_action_performed: false',
  'source_subtype: "content_search_post"',
  'parser_version: PARSER_VERSION'
]) assert(background.includes(marker), `missing payload marker: ${marker}`);

const prohibited = [
  "chrome.tabs.create", "chrome.tabs.update", "scrollIntoView", "window.scrollTo",
  ".click(", "dispatchEvent", "navigator.webdriver", "Math.random", "captcha", "cloudflare",
  "chrome.runtime.sendMessage({type: \"CONNECT\"", "chrome.notifications"
];
for (const marker of prohibited) {
  assert(!background.toLowerCase().includes(marker.toLowerCase()), `background contains prohibited marker: ${marker}`);
  assert(!content.toLowerCase().includes(marker.toLowerCase()), `content contains prohibited marker: ${marker}`);
}

const context = {URL, globalThis: {}};
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
  helper.canonicalPostUrl("", "urn:li:activity:1234567890123456789"),
  "https://www.linkedin.com/feed/update/urn:li:activity:1234567890123456789"
);

console.log("LinkedIn extension contract passed.");
