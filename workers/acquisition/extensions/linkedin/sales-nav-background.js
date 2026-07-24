(() => {
  "use strict";

  const COLLECTOR = "http://127.0.0.1:8785";
  const PARSER_VERSION = "sales-navigator-extension-1.0.0";
  const CONTENT_SCRIPT_FILES = ["sales-nav.js"];
  const CAMPAIGNS_KEY = "codistan_sales_nav_campaigns";
  const STATUS_KEY = "codistan_sales_nav_status";
  const ENABLED_KEY = "codistan_sales_nav_scheduler_enabled";
  const ALARM = "codistan_sales_nav_campaign_cycle";
  const INTERVAL_MINUTES = 12 * 60;
  const MAX_SCROLL_STEPS = 3;
  const MAX_RECORDS = 30;
  const PAGE_SETTLE_MS = 5000;
  const SCROLL_WAIT_MS = 3000;
  const BETWEEN_SEARCH_MS = 4000;
  let activeRun = null;

  const DEFAULT_CAMPAIGN = {
    id: "fintech_backend_operations",
    name: "FinTech Backend Operations Platform",
    enabled: true,
    offer_type: "hybrid",
    offer_name: "FinTech Backend Operations Platform + Managed Delivery",
    offer_summary: "Backend operations platform and managed product-delivery partnership for fintech, payments, lending, wallet, digital-banking, remittance and financial-infrastructure companies.",
    service_route: "software_product",
    service_lanes: ["software_product", "delivery_partner", "ai_automation"],
    target_industry_terms: [
      "fintech", "payments", "payment infrastructure", "digital banking", "wallet", "lending",
      "NBFC", "microfinance", "remittance", "cross-border payments", "financial infrastructure"
    ],
    target_personas: [
      "Founder", "Co-Founder", "CEO", "COO", "CTO", "CIO", "VP Engineering", "VP Product",
      "Head of Operations", "Head of Product", "Head of Technology", "Head of Platform",
      "Head of Digital Transformation", "Head of Partnerships", "Head of Integrations"
    ],
    target_geographies: [],
    search_urls: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeList(value) {
    if (Array.isArray(value)) return [...new Set(value.map(item => String(item || "").trim()).filter(Boolean))];
    return [...new Set(String(value || "").split(/[\n,]/).map(item => item.trim()).filter(Boolean))];
  }

  function normalizeCampaign(input, existing = {}) {
    const id = String(input?.id || existing.id || "").trim().replace(/[^a-z0-9_-]/gi, "_").toLowerCase();
    if (!id) throw new Error("Campaign ID is required.");
    const name = String(input?.name || existing.name || "").trim();
    const offerName = String(input?.offer_name || existing.offer_name || "").trim();
    if (!name || !offerName) throw new Error("Campaign name and offer name are required.");
    return {
      ...existing,
      id,
      name,
      enabled: input?.enabled !== false,
      offer_type: ["product", "service", "hybrid"].includes(input?.offer_type) ? input.offer_type : existing.offer_type || "hybrid",
      offer_name: offerName,
      offer_summary: String(input?.offer_summary || existing.offer_summary || "").trim().slice(0, 3000),
      service_route: String(input?.service_route || existing.service_route || "software_product").trim(),
      service_lanes: normalizeList(input?.service_lanes ?? existing.service_lanes),
      target_industry_terms: normalizeList(input?.target_industry_terms ?? existing.target_industry_terms),
      target_personas: normalizeList(input?.target_personas ?? existing.target_personas),
      target_geographies: normalizeList(input?.target_geographies ?? existing.target_geographies),
      search_urls: normalizeList(input?.search_urls ?? existing.search_urls).map(normalizeSearchUrl),
      created_at: existing.created_at || input?.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
  }

  function normalizeSearchUrl(value) {
    const url = new URL(String(value || "").trim());
    if (!["www.linkedin.com", "linkedin.com", "sales.linkedin.com"].includes(url.hostname)) {
      throw new Error("Sales Navigator searches must use an approved LinkedIn host.");
    }
    const supported = url.pathname.startsWith("/sales/search/people")
      || url.pathname.startsWith("/sales/search/lead")
      || url.pathname.startsWith("/sales/lists/people")
      || url.pathname.startsWith("/search/people");
    if (!supported) throw new Error("Open a Sales Navigator lead-search or people-list page before registering it.");
    url.protocol = "https:";
    url.hostname = "www.linkedin.com";
    url.hash = "";
    return url.toString();
  }

  async function loadCampaigns() {
    const stored = await chrome.storage.local.get(CAMPAIGNS_KEY);
    const raw = Array.isArray(stored[CAMPAIGNS_KEY]) ? stored[CAMPAIGNS_KEY] : [];
    if (raw.length === 0) {
      const seeded = [clone(DEFAULT_CAMPAIGN)];
      await chrome.storage.local.set({[CAMPAIGNS_KEY]: seeded});
      return seeded;
    }
    return raw.map(value => normalizeCampaign(value, value));
  }

  async function saveCampaigns(campaigns) {
    const normalized = campaigns.map(value => normalizeCampaign(value, value));
    await chrome.storage.local.set({[CAMPAIGNS_KEY]: normalized});
    return normalized;
  }

  async function schedulerEnabled() {
    const stored = await chrome.storage.local.get(ENABLED_KEY);
    return stored[ENABLED_KEY] !== false;
  }

  async function ensureAlarm() {
    if (!(await schedulerEnabled())) {
      await chrome.alarms.clear(ALARM);
      return;
    }
    const existing = await chrome.alarms.get(ALARM);
    if (!existing || Number(existing.periodInMinutes) !== INTERVAL_MINUTES) {
      await chrome.alarms.create(ALARM, {delayInMinutes: 5, periodInMinutes: INTERVAL_MINUTES});
    }
  }

  async function request(path, options = {}) {
    const response = await fetch(`${COLLECTOR}${path}`, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Sales Navigator collector returned ${response.status}`);
    return data;
  }

  function missingReceiver(error) {
    return /receiving end does not exist|could not establish connection|message port closed/i.test(error instanceof Error ? error.message : String(error || ""));
  }

  async function sendToTab(tabId, message) {
    try {
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (error) {
      if (!missingReceiver(error)) throw error;
      await chrome.scripting.executeScript({target: {tabId}, files: CONTENT_SCRIPT_FILES});
      await sleep(500);
      return chrome.tabs.sendMessage(tabId, message);
    }
  }

  function mergeRecord(existing, incoming) {
    if (!existing) return incoming;
    return {
      ...existing,
      ...incoming,
      title: String(incoming.title || "").length >= String(existing.title || "").length ? incoming.title : existing.title,
      body: String(incoming.body || "").length >= String(existing.body || "").length ? incoming.body : existing.body,
      author: {...(existing.author || {}), ...(incoming.author || {})},
      commercial_evidence: {...(existing.commercial_evidence || {}), ...(incoming.commercial_evidence || {})},
      raw_evidence: {...(existing.raw_evidence || {}), ...(incoming.raw_evidence || {})}
    };
  }

  function addRecords(map, records) {
    const before = map.size;
    for (const record of Array.isArray(records) ? records : []) {
      const key = String(record.source_native_id || record.source_url || "").trim();
      if (!key) continue;
      map.set(key, mergeRecord(map.get(key), record));
      if (map.size >= MAX_RECORDS) break;
    }
    return map.size - before;
  }

  function campaignRecord(record, campaign, pageUrl, pageTitle, trigger) {
    const cardText = `${record.body || ""} ${record.author?.headline || ""} ${record.author?.company || ""}`.toLowerCase();
    const industryMatch = campaign.target_industry_terms.some(term => cardText.includes(String(term).toLowerCase()));
    const geographyText = String(record.raw_evidence?.location || "").toLowerCase();
    const geographyMatch = campaign.target_geographies.length === 0
      ? null
      : campaign.target_geographies.some(term => geographyText.includes(String(term).toLowerCase()));
    return {
      ...record,
      commercial_evidence: {
        ...(record.commercial_evidence || {}),
        campaign_id: campaign.id,
        campaign_name: campaign.name,
        offer_type: campaign.offer_type,
        offer_name: campaign.offer_name,
        offer_summary: campaign.offer_summary,
        service_route: campaign.service_route,
        service_lanes: campaign.service_lanes,
        target_industry_terms: campaign.target_industry_terms,
        target_personas: campaign.target_personas,
        target_geographies: campaign.target_geographies,
        industry_match: industryMatch || null,
        geography_match: geographyMatch
      },
      raw_evidence: {
        ...(record.raw_evidence || {}),
        sales_navigator_campaign_id: campaign.id,
        registered_search_url: pageUrl,
        page_title: String(pageTitle || ""),
        capture_trigger: trigger,
        external_action_performed: false
      }
    };
  }

  async function submit(campaign, pageResult, records, trigger, tabId) {
    const pageUrl = String(pageResult.page_url || "");
    const prepared = records.slice(0, MAX_RECORDS).map(record => campaignRecord(record, campaign, pageUrl, pageResult.page_title, trigger));
    const response = await request("/capture", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        source: "sales_navigator",
        source_subtype: "campaign_lead_search",
        parser_version: PARSER_VERSION,
        page_url: pageUrl,
        page_identity: `${campaign.id} — ${campaign.name}`,
        external_action_performed: false,
        records: prepared
      })
    });
    if (tabId) {
      await chrome.action.setBadgeBackgroundColor({tabId, color: response.accepted > 0 ? "#7b1fa2" : "#5f6368"}).catch(() => {});
      await chrome.action.setBadgeText({tabId, text: response.accepted > 0 ? String(response.accepted) : "✓"}).catch(() => {});
    }
    return response;
  }

  async function scanTab(tab, campaign, trigger) {
    const first = await sendToTab(tab.id, {type: "CODISTAN_CAPTURE_VISIBLE_SALES_NAVIGATOR_LEADS", limit: MAX_RECORDS});
    if (!first?.ok) throw new Error(first?.error || "Sales Navigator extraction failed.");
    const map = new Map();
    addRecords(map, first.records);
    const status = await sendToTab(tab.id, {type: "CODISTAN_SALES_NAV_SCROLL_STATUS"});
    const originalTop = Number(status?.top || 0);
    let scrollSteps = 0;
    let stopReason = "scroll_limit";
    let latest = first;
    try {
      for (let step = 0; step < MAX_SCROLL_STEPS && map.size < MAX_RECORDS; step += 1) {
        const result = await sendToTab(tab.id, {type: "CODISTAN_SCROLL_SALES_NAV_RESULTS", wait_ms: SCROLL_WAIT_MS});
        if (!result?.ok) throw new Error(result?.error || "Sales Navigator scrolling failed.");
        if (!result.moved) {
          stopReason = result.reason || "end_of_results";
          break;
        }
        scrollSteps += 1;
        latest = await sendToTab(tab.id, {type: "CODISTAN_CAPTURE_VISIBLE_SALES_NAVIGATOR_LEADS", limit: MAX_RECORDS});
        const added = addRecords(map, latest.records);
        if (result.at_end) {
          stopReason = "end_of_results";
          break;
        }
        if (added === 0 && Number(result.after_height || 0) <= Number(result.before_height || 0) + 20) {
          stopReason = "no_new_results";
          break;
        }
      }
    } finally {
      await sendToTab(tab.id, {type: "CODISTAN_RESTORE_SALES_NAV_SCROLL", top: originalTop}).catch(() => {});
    }
    const records = [...map.values()].slice(0, MAX_RECORDS);
    if (records.length === 0) return {accepted: 0, duplicates: 0, enriched: 0, rejected: 0, record_count: 0, scroll_steps: scrollSteps, stop_reason: stopReason, diagnostics: latest.diagnostics || {}};
    return {
      ...(await submit(campaign, latest, records, trigger, tab.id)),
      record_count: records.length,
      scroll_steps: scrollSteps,
      stop_reason: stopReason,
      diagnostics: latest.diagnostics || {}
    };
  }

  async function waitForTab(tabId, timeout = 35000) {
    const initial = await chrome.tabs.get(tabId);
    if (initial.status === "complete") return initial;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        reject(new Error("Sales Navigator search did not finish loading."));
      }, timeout);
      const listener = (updatedId, info, tab) => {
        if (updatedId !== tabId || info.status !== "complete") return;
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve(tab);
      };
      chrome.tabs.onUpdated.addListener(listener);
    });
  }

  async function runSearch(campaign, searchUrl) {
    let tabId = null;
    try {
      const created = await chrome.tabs.create({url: searchUrl, active: false});
      tabId = created.id || null;
      if (!tabId) throw new Error("Chrome could not open the registered Sales Navigator search.");
      await waitForTab(tabId);
      await sleep(PAGE_SETTLE_MS);
      const tab = await chrome.tabs.get(tabId);
      const current = String(tab.url || "");
      if (/linkedin\.com\/(?:login|checkpoint|authwall)/i.test(current)) throw new Error("LinkedIn requires a valid signed-in Sales Navigator session.");
      if (!/linkedin\.com\/sales\//i.test(current) && !/sales\.linkedin\.com\//i.test(current)) throw new Error("The registered search redirected outside Sales Navigator.");
      return {ok: true, search_url: searchUrl, ...(await scanTab(tab, campaign, "scheduled_sales_navigator_campaign"))};
    } catch (error) {
      return {ok: false, search_url: searchUrl, error: error instanceof Error ? error.message : String(error)};
    } finally {
      if (tabId) await chrome.tabs.remove(tabId).catch(() => {});
    }
  }

  async function runCampaigns(trigger = "alarm", requestedCampaignId = "") {
    if (activeRun) return activeRun;
    activeRun = (async () => {
      const campaigns = (await loadCampaigns()).filter(campaign => campaign.enabled && (!requestedCampaignId || campaign.id === requestedCampaignId));
      const status = {running: true, trigger, started_at: new Date().toISOString(), completed_at: "", campaigns: [], accepted: 0, duplicates: 0, enriched: 0, rejected: 0, last_error: ""};
      await chrome.storage.local.set({[STATUS_KEY]: status});
      try {
        await request("/health");
        for (const campaign of campaigns) {
          const campaignStatus = {id: campaign.id, name: campaign.name, searches: []};
          for (const searchUrl of campaign.search_urls) {
            const result = await runSearch(campaign, searchUrl);
            campaignStatus.searches.push(result);
            status.accepted += Number(result.accepted || 0);
            status.duplicates += Number(result.duplicates || 0);
            status.enriched += Number(result.enriched || 0);
            status.rejected += Number(result.rejected || 0);
            await sleep(BETWEEN_SEARCH_MS);
          }
          status.campaigns.push(campaignStatus);
          await chrome.storage.local.set({[STATUS_KEY]: clone(status)});
        }
      } catch (error) {
        status.last_error = error instanceof Error ? error.message : String(error);
      } finally {
        status.running = false;
        status.completed_at = new Date().toISOString();
        await chrome.storage.local.set({[STATUS_KEY]: status});
      }
      return status;
    })().finally(() => { activeRun = null; });
    return activeRun;
  }

  async function recentSalesNavTab() {
    const tabs = await chrome.tabs.query({url: ["https://www.linkedin.com/sales/*", "https://sales.linkedin.com/*"]});
    if (!tabs.length) throw new Error("Open the Sales Navigator lead search that should be registered.");
    return tabs.sort((a, b) => Number(b.lastAccessed || 0) - Number(a.lastAccessed || 0))[0];
  }

  async function registerSearch(campaignId, suppliedUrl = "") {
    const campaigns = await loadCampaigns();
    const campaign = campaigns.find(item => item.id === campaignId);
    if (!campaign) throw new Error("The selected campaign does not exist.");
    const tab = suppliedUrl ? null : await recentSalesNavTab();
    const url = normalizeSearchUrl(suppliedUrl || tab?.url || "");
    if (!campaign.search_urls.includes(url)) campaign.search_urls.push(url);
    campaign.updated_at = new Date().toISOString();
    await saveCampaigns(campaigns);
    return {campaign, url};
  }

  chrome.runtime.onInstalled.addListener(async details => {
    await loadCampaigns();
    if (details.reason === "install") await chrome.storage.local.set({[ENABLED_KEY]: true});
    await ensureAlarm();
  });
  chrome.runtime.onStartup.addListener(() => ensureAlarm().catch(() => {}));
  chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm.name === ALARM) runCampaigns("alarm").catch(() => {});
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message) return false;
    if (message.type === "CODISTAN_GET_SALES_NAV_CAMPAIGNS") {
      Promise.all([loadCampaigns(), schedulerEnabled(), chrome.storage.local.get(STATUS_KEY)])
        .then(([campaigns, enabled, stored]) => sendResponse({ok: true, campaigns, enabled, interval_minutes: INTERVAL_MINUTES, status: stored[STATUS_KEY] || null}))
        .catch(error => sendResponse({ok: false, error: error instanceof Error ? error.message : String(error)}));
      return true;
    }
    if (message.type === "CODISTAN_SAVE_SALES_NAV_CAMPAIGN") {
      (async () => {
        const campaigns = await loadCampaigns();
        const index = campaigns.findIndex(item => item.id === String(message.campaign?.id || ""));
        const normalized = normalizeCampaign(message.campaign, index >= 0 ? campaigns[index] : {});
        if (index >= 0) campaigns[index] = normalized;
        else campaigns.push(normalized);
        await saveCampaigns(campaigns);
        sendResponse({ok: true, campaign: normalized});
      })().catch(error => sendResponse({ok: false, error: error instanceof Error ? error.message : String(error)}));
      return true;
    }
    if (message.type === "CODISTAN_REGISTER_SALES_NAV_SEARCH") {
      registerSearch(String(message.campaign_id || DEFAULT_CAMPAIGN.id), String(message.search_url || ""))
        .then(result => sendResponse({ok: true, ...result}))
        .catch(error => sendResponse({ok: false, error: error instanceof Error ? error.message : String(error)}));
      return true;
    }
    if (message.type === "CODISTAN_REMOVE_SALES_NAV_SEARCH") {
      (async () => {
        const campaigns = await loadCampaigns();
        const campaign = campaigns.find(item => item.id === String(message.campaign_id || ""));
        if (!campaign) throw new Error("Campaign not found.");
        const target = normalizeSearchUrl(message.search_url);
        campaign.search_urls = campaign.search_urls.filter(url => url !== target);
        await saveCampaigns(campaigns);
        sendResponse({ok: true, campaign});
      })().catch(error => sendResponse({ok: false, error: error instanceof Error ? error.message : String(error)}));
      return true;
    }
    if (message.type === "CODISTAN_RUN_SALES_NAV_CAMPAIGNS_NOW") {
      runCampaigns("manual", String(message.campaign_id || ""))
        .then(status => sendResponse({ok: true, ...status}))
        .catch(error => sendResponse({ok: false, error: error instanceof Error ? error.message : String(error)}));
      return true;
    }
    if (message.type === "CODISTAN_SET_SALES_NAV_AUTOMATION") {
      (async () => {
        await chrome.storage.local.set({[ENABLED_KEY]: message.enabled === true});
        await ensureAlarm();
        sendResponse({ok: true, enabled: message.enabled === true, interval_minutes: INTERVAL_MINUTES});
      })().catch(error => sendResponse({ok: false, error: error instanceof Error ? error.message : String(error)}));
      return true;
    }
    return false;
  });

  loadCampaigns().then(ensureAlarm).catch(() => {});
})();
