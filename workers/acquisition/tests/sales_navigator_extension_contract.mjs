import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve("extensions/linkedin");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const entry = fs.readFileSync(path.join(root, "background-entry.js"), "utf8");
const background = fs.readFileSync(path.join(root, "sales-nav-background.js"), "utf8");
const catalogue = fs.readFileSync(path.join(root, "sales-nav-catalogue.js"), "utf8");
const content = fs.readFileSync(path.join(root, "sales-nav.js"), "utf8");
const optionsHtml = fs.readFileSync(path.join(root, "sales-nav-options.html"), "utf8");
const optionsJs = fs.readFileSync(path.join(root, "sales-nav-options.js"), "utf8");
const optionsPersist = fs.readFileSync(path.join(root, "sales-nav-options-persist.js"), "utf8");

for (const [name, source] of Object.entries({entry, background, catalogue, content, optionsJs, optionsPersist})) {
  assert.doesNotThrow(() => new vm.Script(source), `${name} must parse as JavaScript`);
}

assert.equal(manifest.version, "1.6.2");
assert.equal(manifest.background.service_worker, "background-entry.js");
assert(entry.includes('sales-nav-catalogue.js'));
assert(entry.includes('sales-nav-background.js'));
assert(entry.indexOf('sales-nav-catalogue.js') < entry.indexOf('sales-nav-background.js'));
assert.deepEqual([...manifest.permissions].sort(), ["alarms", "scripting", "storage", "tabs"]);
assert(!manifest.permissions.includes("activeTab"));
assert(manifest.host_permissions.includes("https://www.linkedin.com/*"));
assert(manifest.host_permissions.includes("https://sales.linkedin.com/*"));
assert(manifest.host_permissions.includes("http://127.0.0.1:8785/*"));
assert(manifest.host_permissions.includes("http://127.0.0.1:8795/*"));
assert.deepEqual(manifest.content_scripts[1].js, ["parser-hardening.js", "sales-nav.js"]);
assert.equal(manifest.options_page, "sales-nav-options.html");

for (const marker of [
  'COLLECTOR = "http://127.0.0.1:8785"',
  'PARSER_VERSION = "sales-navigator-extension-1.0.0"',
  'INTERVAL_MINUTES = 12 * 60',
  'MAX_SCROLL_STEPS = 3',
  'MAX_RECORDS = 30',
  'DEFAULT_CAMPAIGN',
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
]) assert(background.includes(marker), `missing Sales Navigator runtime marker: ${marker}`);

for (const marker of [
  'offer-campaign-catalogue-v1',
  'fintech_direct_buyers',
  'fintech_channel_partners',
  'software_ai_overflow_partners',
  'direct_buyer',
  'channel_partner',
  'delivery_partner',
  'fintech_backend_operations_legacy',
  'superseded_by',
  'state: "on_hold"',
  'search_urls: []',
]) assert(catalogue.includes(marker), `missing campaign catalogue marker: ${marker}`);

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
  'sales-navigator-dom-1.1.0',
]) assert(content.includes(marker), `missing Sales Navigator DOM marker: ${marker}`);

for (const marker of [
  'Campaign portfolio',
  'Create campaign',
  'Duplicate selected campaign',
  'Campaign active',
  'Campaign route',
  'Direct buyer',
  'Channel / implementation partner',
  'Overflow / delivery partner',
  'Target industries',
  'Target company types',
  'Target personas',
  'Target geographies',
  'Positive campaign terms',
  'Approved searches for selected campaign',
  'Register search',
  'Run selected campaign now',
  'No automatic outreach',
]) assert(optionsHtml.includes(marker), `missing campaign settings control: ${marker}`);

for (const marker of [
  'CODISTAN_GET_SALES_NAV_CAMPAIGNS',
  'CODISTAN_SAVE_SALES_NAV_CAMPAIGN',
  'CODISTAN_REGISTER_SALES_NAV_SEARCH',
  'CODISTAN_REMOVE_SALES_NAV_SEARCH',
  'CODISTAN_RUN_SALES_NAV_CAMPAIGNS_NOW',
  'CODISTAN_SET_SALES_NAV_AUTOMATION',
  'campaignSelect',
  'newCampaignId',
  'research_only',
  'on_hold',
  'No explicit buying intent',
  'visible_lead_links',
  'readable_cards',
  'missing_name',
  'missing_company',
]) assert(optionsJs.includes(marker), `missing campaign settings behavior: ${marker}`);

for (const marker of [
  'codistan_sales_nav_campaigns',
  'campaignRoute',
  'offer_id',
  'target_company_types',
  'target_seniority',
  'positive_terms',
  'search_urls: list(existing.search_urls)',
]) assert(optionsPersist.includes(marker), `missing complete campaign persistence marker: ${marker}`);

const externalSurface = `${background}\n${catalogue}\n${content}\n${optionsJs}`.toLowerCase();
for (const prohibited of [
  'dispatchevent', 'navigator.webdriver', 'captcha', 'cloudflare',
  'sendinmail(', 'sendlinkedinmessage(', 'connectrequest(', 'createconnectionrequest(',
  'savelead(', 'followlead(', 'sendemail(', 'submitproposal(',
  'external_action_performed: true', 'chrome.tabs.update',
  'chrome.cookies', 'document.cookie', 'localstorage.getitem', 'sessionstorage.getitem',
  'eval(', 'new function(', 'importscripts("http', "importscripts('http",
]) assert(!externalSurface.includes(prohibited.toLowerCase()), `Sales Navigator extension contains prohibited action/privacy marker: ${prohibited}`);

assert(background.includes('chrome.tabs.sendMessage'));
assert(!content.includes('scrollIntoView'));
assert(!background.includes('chrome.tabs.update'));
assert(!background.includes('buyerIntentConfirmed: true'));
assert(optionsHtml.includes('never saves a lead, connects, follows, sends InMail, messages, emails'));

console.log("Sales Navigator multi-route campaign extension contract passed.");
