import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve("extensions/upwork");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const background = fs.readFileSync(path.join(root, "background.js"), "utf8");
const content = fs.readFileSync(path.join(root, "content.js"), "utf8");
const popup = fs.readFileSync(path.join(root, "popup.js"), "utf8");
const evidenceSource = fs.readFileSync(path.join(root, "evidence.js"), "utf8");

assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.version, "1.0.1");
assert.deepEqual(manifest.content_scripts[0].js, ["evidence.js", "content.js"]);
assert(manifest.host_permissions.includes("http://127.0.0.1:8765/*"));

for (const name of [
  "AI + Fullstack AI 16 July 2026",
  "3D Design & Creatives 15 July 2026",
  "Game & AR/VR 16 July 2026"
]) {
  assert(background.includes(name), `background missing approved search: ${name}`);
  assert(content.includes(name), `content missing approved search: ${name}`);
}
for (const id of ["9652811", "9652860", "9652877"]) assert(background.includes(id));
assert(background.includes("/^\\/nx\\/find-work\\/\\d+$/"), "numeric find-work paths must be accepted dynamically");
assert(background.includes("activeSavedSearchName"));
assert(content.includes("active_saved_search_name"));
assert(content.includes("commercialTextForCard"));
assert(content.includes("commercial_fields_detected"));
assert(popup.includes("active_saved_search_name"));

for (const marker of [
  'source: "upwork"',
  'external_action_performed: false',
  'source_subtype: "saved_search_card"',
  'parser_version: PARSER_VERSION'
]) assert(background.includes(marker), `missing payload marker: ${marker}`);

const prohibited = [
  "chrome.tabs.create", "chrome.tabs.update", "scrollIntoView", "window.scrollTo",
  ".click(", "dispatchEvent", "navigator.webdriver", "Math.random", "captcha", "cloudflare"
];
for (const marker of prohibited) {
  assert(!background.toLowerCase().includes(marker.toLowerCase()), `background contains prohibited marker: ${marker}`);
  assert(!content.toLowerCase().includes(marker.toLowerCase()), `content contains prohibited marker: ${marker}`);
}

const context = {URL, globalThis: {}};
vm.createContext(context);
vm.runInContext(evidenceSource, context);
const helper = context.globalThis.CodistanUpworkEvidence;
assert(helper);
assert.equal(helper.nativeIdFromUrl("https://www.upwork.com/jobs/~0123456789abcdef?x=1"), "~0123456789abcdef");

const fixed = helper.parseCommercialEvidence(
  "Posted 2 hours ago Fixed-price Est. Budget: $12,000 Payment verified $50K+ spent 75% hire rate Fewer than 5 proposals Expert"
);
assert.equal(fixed.fixed_budget_usd, 12000);
assert.equal(fixed.client_spend_usd, 50000);
assert.equal(fixed.hire_rate_percent, 75);
assert.equal(fixed.payment_verified, true);
assert.equal(fixed.proposals, "Fewer than 5 proposals");
assert.equal(fixed.experience_level, "Expert");

const hourly = helper.parseCommercialEvidence(
  "Posted 3 minutes ago Proposals: Fewer than 5 Hourly: $60-$90 Intermediate Est. Time: 1 to 3 months, 30+ hrs/week Payment verified $7K+ spent"
);
assert.equal(hourly.hourly_min_usd, 60);
assert.equal(hourly.hourly_max_usd, 90);
assert.equal(hourly.client_spend_usd, 7000);
assert.equal(hourly.proposals, "Fewer than 5 proposals");
assert.equal(hourly.duration, "1 to 3 months");
assert.equal(hourly.weekly_hours, "30+ hrs/week");
assert(helper.evidenceScore("Fixed-price Est. Budget: $5,000 Payment verified") >= 2);

console.log("Upwork extension contract passed.");
