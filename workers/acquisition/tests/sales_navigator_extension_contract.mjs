import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve("extensions/linkedin");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const entry = fs.readFileSync(path.join(root, "background-entry.js"), "utf8");
const background = fs.readFileSync(path.join(root, "sales-nav-background.js"), "utf8");
const content = fs.readFileSync(path.join(root, "sales-nav.js"), "utf8");
const optionsHtml = fs.readFileSync(path.join(root, "sales-nav-options.html"), "utf8");
const optionsJs = fs.readFileSync(path.join(root, "sales-nav-options.js"), "utf8");

assert.equal(manifest.version, "1.4.0");
assert.equal(manifest.background.service_worker, "background-entry.js");
assert(entry.includes('sales-nav-background.js'));
assert(manifest.permissions.includes("alarms"));
assert(manifest.permissions.includes("tabs"));
assert(manifest.permissions.includes("storage"));
assert(manifest.host_permissions.includes("https://www.linkedin.com/*"));
assert(manifest.host_permissions.includes("https://sales.linkedin.com/*"));
assert(manifest.host_permissions.includes("http://127.0.0.1:8785/*"));
assert.deepEqual(manifest.content_scripts[1].js, ["sales-nav.js"]);
assert.equal(manifest.options_page, "sales-nav-options.html");

for (const marker of [
  'COLLECTOR = "http://127.0.0.1:8785"',
  'PARSER_VERSION = "sales-navigator-extension-1.0.0"',
  'INTERVAL_MINUTES = 12 * 60',
  'MAX_SCROLL_STEPS = 3',
  'MAX_RECORDS = 30',
  'DEFAULT_CAMPAIGN',
  'id: "fintech_backend_operations"',
  'FinTech Backend Operations Platform',
  'source: "sales_navigator"',
  'source_subtype: "campaign_lead_search"',
  'external_action_performed: false',
  'chrome.tabs.create({url: searchUrl, active: false})',
  'chrome.tabs.remove(tabId)',
  'if (activeRun) return activeRun',
  'CODISTAN_GET_SALES_NAV_CAMPAIGNS',
  'CODISTAN_SAVE_SALES_NAV_CAMPAIGN',
  'CODISTAN_REGISTER_SALES_NAV_SEARCH',
  'CODISTAN_REMOVE_SALES_NAV_SEARCH',
  'CODISTAN_RUN_SALES_NAV_CAMPAIGNS_NOW',
  'CODISTAN_SET_SALES_NAV_AUTOMATION',
  'checkpoint',
  'authwall',
]) assert(background.includes(marker), `missing Sales Navigator campaign marker: ${marker}`);

for (const marker of [
  'a[href*="/sales/lead/"]',
  'a[href*="/in/"]',
  'data-anonymize="person-name"',
  'data-anonymize="headline"',
  'data-anonymize="company-name"',
  'mutual_connections',
  'posted_on_linkedin',
  'changed_jobs',
  'teamlink',
  'CODISTAN_CAPTURE_VISIBLE_SALES_NAVIGATOR_LEADS',
  'CODISTAN_SCROLL_SALES_NAV_RESULTS',
  'CODISTAN_RESTORE_SALES_NAV_SCROLL',
  'sales-navigator-dom-1.0.0',
]) assert(content.includes(marker), `missing Sales Navigator DOM marker: ${marker}`);

for (const marker of [
  'FinTech campaign',
  'Campaign active',
  'Target industries',
  'Target personas',
  'Target geographies',
  'Approved searches',
  'Register search',
  'Run this campaign now',
  'No automatic outreach',
]) assert(optionsHtml.includes(marker), `missing campaign settings control: ${marker}`);

for (const marker of [
  'CODISTAN_GET_SALES_NAV_CAMPAIGNS',
  'CODISTAN_SAVE_SALES_NAV_CAMPAIGN',
  'CODISTAN_REGISTER_SALES_NAV_SEARCH',
  'CODISTAN_REMOVE_SALES_NAV_SEARCH',
  'CODISTAN_RUN_SALES_NAV_CAMPAIGNS_NOW',
  'CODISTAN_SET_SALES_NAV_AUTOMATION',
]) assert(optionsJs.includes(marker), `missing campaign settings behavior: ${marker}`);

const combined = `${background}\n${content}\n${optionsJs}`.toLowerCase();
for (const prohibited of [
  '.click(', 'dispatchEvent', 'navigator.webdriver', 'captcha', 'cloudflare',
  'sendinmail(', 'sendlinkedinmessage(', 'connectrequest(', 'createconnectionrequest(',
  'savelead(', 'followlead(', 'sendemail(', 'submitproposal(',
  'external_action_performed: true', 'chrome.tabs.update',
]) assert(!combined.includes(prohibited.toLowerCase()), `Sales Navigator extension contains prohibited action marker: ${prohibited}`);

assert(background.includes('chrome.tabs.sendMessage'));
assert(!content.includes('scrollIntoView'));
assert(!background.includes('chrome.tabs.update'));
assert(!background.includes('buyerIntentConfirmed: true'));

console.log("Sales Navigator cold campaign extension contract passed.");
