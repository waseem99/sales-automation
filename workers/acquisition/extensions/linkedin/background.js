(() => {
  "use strict";

  const COLLECTOR = "http://127.0.0.1:8775";
  const PARSER_VERSION = "linkedin-extension-1.3.0";
  const CONTENT_SCRIPT_FILES = ["signal.js", "dom-adapter.js", "search-resolver.js", "content.js"];
  const SCHEDULE_ALARM = "codistan_linkedin_approved_search_cycle";
  const SCHEDULE_INTERVAL_MINUTES = 15;
  const MAX_SCROLL_STEPS = 4;
  const MAX_RECORDS = 30;
  const SCROLL_WAIT_MS = 2500;
  const PAGE_SETTLE_MS = 4500;
  const BETWEEN_SEARCH_MS = 3000;
  const SEARCHES = [
    {
      id: "software_delivery",
      label: "Software development partners",
      query: '"looking for" AND ("software development agency" OR "development partner") NOT hiring NOT job NOT role'
    },
    {
      id: "ai_automation",
      label: "AI automation partners",
      query: '("looking for" OR "seeking") AND ("AI automation partner" OR "AI agency") NOT hiring NOT job NOT role'
    },
    {
      id: "digital_marketing",
      label: "Digital marketing agencies",
      query: '("looking for" OR "seeking" OR "request for proposal") AND "digital marketing agency" NOT hiring NOT job'
    },
    {
      id: "creative_delivery",
      label: "Video and animation partners",
      query: '("looking for" OR "seeking") AND ("video production agency" OR "animation studio") NOT hiring NOT job'
    },
    {
      id: "cybersecurity",
      label: "Cybersecurity consultants",
      query: '("looking for" OR "seeking" OR "calling") AND ("cybersecurity consultant" OR "security firm" OR "project-based engagements") NOT hiring NOT job'
    }
  ].map(search => ({
    ...search,
    url: `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(search.query)}&origin=GLOBAL_SEARCH_HEADER`
  }));

  const pendingTimers = new Map();
  const lastAttempts = new Map();
  let scheduledRun = null;

  function sleep(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
  }

  function supportedPage(value) {
    try {
      const url = new URL(value);
      if (!["linkedin.com", "www.linkedin.com"].includes(url.hostname)) return false;
      return url.pathname.startsWith("/search/results/content")
        || url.pathname.startsWith("/feed")
        || url.pathname.startsWith("/posts/")
        || url.pathname.startsWith("/pulse/");
    } catch (_error) {
      return false;
    }
  }

  function pageIdentity(value, title) {
    try {
      const url = new URL(value);
      return url.searchParams.get("keywords") || String(title || "LinkedIn visible page");
    } catch (_error) {
      return String(title || "LinkedIn visible page");
    }
  }

  function missingReceiver(error) {
    const message = error instanceof Error ? error.message : String(error || "");
    return /receiving end does not exist|could not establish connection|message port closed/i.test(message);
  }

  async function request(path, options = {}) {
    const response = await fetch(`${COLLECTOR}${path}`, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Local collector returned ${response.status}`);
    return data;
  }

  async function updateBadge(tabId, text, color) {
    try {
      await chrome.action.setBadgeBackgroundColor({tabId, color});
      await chrome.action.setBadgeText({tabId, text});
      if (text) setTimeout(() => chrome.action.setBadgeText({tabId, text: ""}).catch(() => {}), 5000);
    } catch (_error) {
      // Badge display is non-critical.
    }
  }

  async function storeResult(pageUrl, identity, response, error = "") {
    await chrome.storage.local.set({
      codistan_linkedin_last_capture: {
        at: new Date().toISOString(),
        page_url: pageUrl,
        page_identity: identity,
        response: response || null,
        error
      }
    }).catch(() => {});
  }

  async function storeSchedulerStatus(status) {
    await chrome.storage.local.set({codistan_linkedin_scheduler_status: status}).catch(() => {});
  }

  async function submitPosts({pageUrl, pageTitle, records, trigger, tabId}) {
    if (!supportedPage(pageUrl)) throw new Error("This LinkedIn page is not supported for opportunity capture.");
    if (!Array.isArray(records) || records.length === 0) throw new Error("No direct service-requirement posts were found on the visible page.");
    const identity = pageIdentity(pageUrl, pageTitle);
    const response = await request("/capture", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        source: "linkedin",
        source_subtype: "content_search_post",
        parser_version: PARSER_VERSION,
        page_url: pageUrl,
        page_identity: identity,
        external_action_performed: false,
        records: records.slice(0, MAX_RECORDS).map(record => ({
          ...record,
          raw_evidence: {
            ...(record.raw_evidence || {}),
            search_page_identity: identity,
            page_title: String(pageTitle || ""),
            capture_trigger: String(trigger || "automatic_visible_page")
          }
        }))
      })
    });
    if (tabId) await updateBadge(tabId, response.accepted > 0 ? String(response.accepted) : "✓", response.accepted > 0 ? "#0a66c2" : "#5f6368");
    await storeResult(pageUrl, identity, response);
    return {...response, page_identity: identity};
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

  async function readVisiblePosts(tabId, limit = MAX_RECORDS) {
    const result = await sendToTab(tabId, {type: "CODISTAN_CAPTURE_VISIBLE_LINKEDIN_POSTS", limit});
    if (!result?.ok) throw new Error(result?.error || "LinkedIn visible-post extraction failed.");
    return result;
  }

  function mergeRecord(existing, incoming) {
    if (!existing) return incoming;
    const existingBody = String(existing.body || "");
    const incomingBody = String(incoming.body || "");
    return {
      ...existing,
      ...incoming,
      title: String(incoming.title || "").length >= String(existing.title || "").length ? incoming.title : existing.title,
      body: incomingBody.length >= existingBody.length ? incomingBody : existing.body,
      author: {...(existing.author || {}), ...(incoming.author || {})},
      commercial_evidence: {...(existing.commercial_evidence || {}), ...(incoming.commercial_evidence || {})},
      raw_evidence: {...(existing.raw_evidence || {}), ...(incoming.raw_evidence || {})}
    };
  }

  function addRecords(recordMap, records) {
    const before = recordMap.size;
    for (const record of Array.isArray(records) ? records : []) {
      const key = String(record.source_native_id || record.source_url || "").trim();
      if (!key) continue;
      recordMap.set(key, mergeRecord(recordMap.get(key), record));
      if (recordMap.size >= MAX_RECORDS) break;
    }
    return recordMap.size - before;
  }

  async function scanLinkedInTab(tab, trigger) {
    if (!tab?.id) throw new Error("The LinkedIn search tab is unavailable.");
    const status = await sendToTab(tab.id, {type: "CODISTAN_LINKEDIN_SCROLL_STATUS"});
    if (!status?.ok) throw new Error(status?.error || "The LinkedIn scroll controller is unavailable.");
    const originalTop = Number(status.top || 0);
    const recordMap = new Map();
    let latestResult = await readVisiblePosts(tab.id, MAX_RECORDS);
    addRecords(recordMap, latestResult.records);
    let scrollSteps = 0;
    let noGrowthRounds = 0;
    let stopReason = "scroll_limit";
    let scrollContainer = String(status.scroller || "unknown");

    try {
      for (let step = 0; step < MAX_SCROLL_STEPS && recordMap.size < MAX_RECORDS; step += 1) {
        const scrollResult = await sendToTab(tab.id, {
          type: "CODISTAN_SCROLL_LINKEDIN_RESULTS",
          wait_ms: SCROLL_WAIT_MS
        });
        if (!scrollResult?.ok) throw new Error(scrollResult?.error || "LinkedIn result scrolling failed.");
        scrollContainer = String(scrollResult.scroller || scrollContainer);
        if (!scrollResult.moved) {
          stopReason = scrollResult.reason || "end_of_results";
          break;
        }
        scrollSteps += 1;
        latestResult = await readVisiblePosts(tab.id, MAX_RECORDS);
        const added = addRecords(recordMap, latestResult.records);
        const documentGrew = Number(scrollResult.after_height || 0) > Number(scrollResult.before_height || 0) + 20;
        if (added === 0 && !documentGrew) noGrowthRounds += 1;
        else noGrowthRounds = 0;
        if (scrollResult.at_end) {
          stopReason = "end_of_results";
          break;
        }
        if (noGrowthRounds >= 2) {
          stopReason = "no_new_results";
          break;
        }
      }
    } finally {
      await sendToTab(tab.id, {type: "CODISTAN_RESTORE_LINKEDIN_SCROLL", top: originalTop}).catch(() => {});
    }

    const records = [...recordMap.values()].slice(0, MAX_RECORDS);
    if (records.length === 0) {
      return {
        accepted: 0,
        duplicates: 0,
        enriched: 0,
        rejected: 0,
        record_count: 0,
        scroll_steps: scrollSteps,
        stop_reason: stopReason,
        scroll_container: scrollContainer,
        diagnostics: latestResult.diagnostics || {}
      };
    }
    const response = await submitPosts({
      pageUrl: latestResult.page_url || tab.url || "",
      pageTitle: latestResult.page_title || tab.title || "",
      records,
      trigger,
      tabId: tab.id
    });
    return {
      ...response,
      record_count: records.length,
      scroll_steps: scrollSteps,
      stop_reason: stopReason,
      scroll_container: scrollContainer,
      diagnostics: latestResult.diagnostics || {}
    };
  }

  async function waitForTabComplete(tabId, timeoutMs = 30000) {
    const existing = await chrome.tabs.get(tabId);
    if (existing.status === "complete") return existing;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        reject(new Error("LinkedIn search page did not finish loading in time."));
      }, timeoutMs);
      const listener = (updatedTabId, changeInfo, tab) => {
        if (updatedTabId !== tabId || changeInfo.status !== "complete") return;
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve(tab);
      };
      chrome.tabs.onUpdated.addListener(listener);
    });
  }

  async function runApprovedSearch(search) {
    let tabId = null;
    try {
      const created = await chrome.tabs.create({url: search.url, active: false});
      tabId = created.id || null;
      if (!tabId) throw new Error("Chrome did not create the LinkedIn search tab.");
      let tab = await waitForTabComplete(tabId);
      await sleep(PAGE_SETTLE_MS);
      tab = await chrome.tabs.get(tabId);
      const currentUrl = String(tab.url || "");
      if (/linkedin\.com\/(?:login|checkpoint|authwall)/i.test(currentUrl)) {
        throw new Error("LinkedIn requires the normal Chrome session to be signed in before scheduled capture can run.");
      }
      if (!supportedPage(currentUrl)) throw new Error("LinkedIn redirected the scheduled search to an unsupported page.");
      const result = await scanLinkedInTab(tab, "scheduled_15_minute_search_cycle");
      return {id: search.id, label: search.label, ok: true, ...result};
    } catch (error) {
      return {
        id: search.id,
        label: search.label,
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      };
    } finally {
      if (tabId) await chrome.tabs.remove(tabId).catch(() => {});
    }
  }

  async function schedulerEnabled() {
    const stored = await chrome.storage.local.get("codistan_linkedin_scheduler_enabled");
    return stored.codistan_linkedin_scheduler_enabled !== false;
  }

  async function ensureSchedule() {
    const enabled = await schedulerEnabled();
    if (!enabled) {
      await chrome.alarms.clear(SCHEDULE_ALARM);
      return;
    }
    const existing = await chrome.alarms.get(SCHEDULE_ALARM);
    if (!existing || Number(existing.periodInMinutes) !== SCHEDULE_INTERVAL_MINUTES) {
      await chrome.alarms.create(SCHEDULE_ALARM, {
        delayInMinutes: 1,
        periodInMinutes: SCHEDULE_INTERVAL_MINUTES
      });
    }
  }

  async function runScheduledCycle(trigger = "alarm") {
    if (scheduledRun) return scheduledRun;
    scheduledRun = (async () => {
      const startedAt = new Date().toISOString();
      const status = {
        running: true,
        trigger,
        interval_minutes: SCHEDULE_INTERVAL_MINUTES,
        started_at: startedAt,
        completed_at: "",
        accepted: 0,
        duplicates: 0,
        enriched: 0,
        rejected: 0,
        searches: [],
        last_error: ""
      };
      await storeSchedulerStatus(status);
      try {
        if (!(await schedulerEnabled())) {
          status.running = false;
          status.completed_at = new Date().toISOString();
          status.last_error = "Scheduled LinkedIn capture is disabled.";
          await storeSchedulerStatus(status);
          return status;
        }
        await request("/health");
        for (const search of SEARCHES) {
          const result = await runApprovedSearch(search);
          status.searches.push(result);
          status.accepted += Number(result.accepted || 0);
          status.duplicates += Number(result.duplicates || 0);
          status.enriched += Number(result.enriched || 0);
          status.rejected += Number(result.rejected || 0);
          await storeSchedulerStatus({...status});
          await sleep(BETWEEN_SEARCH_MS);
        }
      } catch (error) {
        status.last_error = error instanceof Error ? error.message : String(error);
      } finally {
        status.running = false;
        status.completed_at = new Date().toISOString();
        await storeSchedulerStatus(status);
      }
      return status;
    })().finally(() => {
      scheduledRun = null;
    });
    return scheduledRun;
  }

  async function autoCaptureTab(tabId, tab, attempt = 1) {
    const pageUrl = String(tab?.url || "");
    if (!supportedPage(pageUrl)) return;
    try {
      const result = await readVisiblePosts(tabId, 20);
      if (!Array.isArray(result.records) || result.records.length === 0) {
        if (attempt < 3) {
          setTimeout(() => autoCaptureTab(tabId, tab, attempt + 1), 4500);
          return;
        }
        await storeResult(pageUrl, pageIdentity(pageUrl, tab.title), {accepted: 0, duplicates: 0, rejected: 0, total_records: 0});
        await updateBadge(tabId, "0", "#5f6368");
        return;
      }
      await submitPosts({
        pageUrl: result.page_url || pageUrl,
        pageTitle: result.page_title || tab.title || "",
        records: result.records,
        trigger: "normal_chrome_linkedin_page_loaded",
        tabId
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await updateBadge(tabId, "!", "#b3261e");
      await storeResult(pageUrl, pageIdentity(pageUrl, tab.title), null, message);
    }
  }

  function scheduleAutoCapture(tabId, tab) {
    const pageUrl = String(tab?.url || "");
    if (!supportedPage(pageUrl)) return;
    const key = `${tabId}:${pageUrl}`;
    const now = Date.now();
    if (now - Number(lastAttempts.get(key) || 0) < 45000) return;
    lastAttempts.set(key, now);
    const existing = pendingTimers.get(tabId);
    if (existing) clearTimeout(existing);
    pendingTimers.set(tabId, setTimeout(() => {
      pendingTimers.delete(tabId);
      autoCaptureTab(tabId, tab).catch(() => {});
    }, 4000));
  }

  chrome.runtime.onInstalled.addListener(async details => {
    if (details.reason === "install") {
      await chrome.storage.local.set({codistan_linkedin_scheduler_enabled: true});
    }
    await ensureSchedule();
  });

  chrome.runtime.onStartup.addListener(() => {
    ensureSchedule().catch(() => {});
  });

  chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm.name === SCHEDULE_ALARM) runScheduledCycle("alarm").catch(() => {});
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    const url = String(changeInfo.url || tab.url || "");
    if (!supportedPage(url)) return;
    if (changeInfo.status === "complete" || Boolean(changeInfo.url)) scheduleAutoCapture(tabId, {...tab, url});
  });

  chrome.tabs.onActivated.addListener(async ({tabId}) => {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (supportedPage(String(tab.url || ""))) scheduleAutoCapture(tabId, tab);
    } catch (_error) {
      // The tab may have closed before inspection.
    }
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message) return false;
    if (message.type === "CODISTAN_SUBMIT_LINKEDIN_POSTS") {
      (async () => {
        const pageUrl = String(message.page_url || sender.tab?.url || "");
        const response = await submitPosts({
          pageUrl,
          pageTitle: String(message.page_title || sender.tab?.title || ""),
          records: message.records,
          trigger: String(message.trigger || "manual_extension_fallback"),
          tabId: sender.tab?.id
        });
        sendResponse({ok: true, ...response});
      })().catch(async error => {
        const tabId = sender.tab?.id;
        if (tabId) await updateBadge(tabId, "!", "#b3261e");
        sendResponse({ok: false, error: error instanceof Error ? error.message : String(error)});
      });
      return true;
    }
    if (message.type === "CODISTAN_RUN_LINKEDIN_SCHEDULED_SCAN_NOW") {
      runScheduledCycle("manual_run_all_searches")
        .then(result => sendResponse({ok: true, ...result}))
        .catch(error => sendResponse({ok: false, error: error instanceof Error ? error.message : String(error)}));
      return true;
    }
    if (message.type === "CODISTAN_GET_LINKEDIN_AUTOMATION_STATUS") {
      Promise.all([
        schedulerEnabled(),
        chrome.storage.local.get("codistan_linkedin_scheduler_status")
      ]).then(([enabled, stored]) => sendResponse({
        ok: true,
        enabled,
        interval_minutes: SCHEDULE_INTERVAL_MINUTES,
        searches: SEARCHES.map(({id, label}) => ({id, label})),
        status: stored.codistan_linkedin_scheduler_status || null
      })).catch(error => sendResponse({ok: false, error: error instanceof Error ? error.message : String(error)}));
      return true;
    }
    if (message.type === "CODISTAN_SET_LINKEDIN_AUTOMATION") {
      (async () => {
        const enabled = message.enabled === true;
        await chrome.storage.local.set({codistan_linkedin_scheduler_enabled: enabled});
        await ensureSchedule();
        sendResponse({ok: true, enabled, interval_minutes: SCHEDULE_INTERVAL_MINUTES});
      })().catch(error => sendResponse({ok: false, error: error instanceof Error ? error.message : String(error)}));
      return true;
    }
    return false;
  });

  ensureSchedule().catch(() => {});
})();
