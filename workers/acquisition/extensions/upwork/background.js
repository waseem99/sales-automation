(() => {
  "use strict";

  const COLLECTOR = "http://127.0.0.1:8765";
  const PARSER_VERSION = "upwork-extension-1.1.0";
  const CONTENT_SCRIPT_FILES = ["evidence.js", "scroll.js", "content.js"];
  const SCHEDULE_ALARM = "codistan_upwork_approved_search_cycle";
  const SCHEDULE_POLICY_VERSION = "upwork-scheduler-v1";
  const SCHEDULE_INTERVAL_MINUTES = 15;
  const MAX_SCROLL_STEPS = 4;
  const MAX_RECORDS = 30;
  const SCROLL_WAIT_MS = 2500;
  const PAGE_SETTLE_MS = 5000;
  const BETWEEN_SEARCH_MS = 3000;
  const APPROVED_SEARCH_LIST = [
    {
      id: "ai_fullstack",
      path: "/nx/find-work/9652811",
      savedSearchName: "AI + Fullstack AI 16 July 2026",
      segment: "ai-jobs",
      owner: "Waseem"
    },
    {
      id: "creative_3d",
      path: "/nx/find-work/9652860",
      savedSearchName: "3D Design & Creatives 15 July 2026",
      segment: "roshana-2d-3d",
      owner: "Roshana"
    },
    {
      id: "game_ar_vr",
      path: "/nx/find-work/9652877",
      savedSearchName: "Game & AR/VR 16 July 2026",
      segment: "nadir-game-ar-vr",
      owner: "Nadir"
    }
  ].map(search => ({...search, url: `https://www.upwork.com${search.path}`}));
  const APPROVED_SEARCHES = Object.fromEntries(
    APPROVED_SEARCH_LIST.map(search => [search.savedSearchName, {
      segment: search.segment,
      owner: search.owner,
      id: search.id,
      path: search.path,
      url: search.url
    }])
  );
  const LEGACY_SEARCHES_BY_PATH = Object.fromEntries(
    APPROVED_SEARCH_LIST.map(search => [search.path, search.savedSearchName])
  );

  const pendingTimers = new Map();
  const lastAttempts = new Map();
  const scheduledTabIds = new Set();
  let scheduledRun = null;

  function sleep(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(milliseconds) || 0)));
  }

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function pagePath(value) {
    try {
      const url = new URL(value);
      if (!["upwork.com", "www.upwork.com"].includes(url.hostname)) return "";
      return url.pathname.replace(/\/$/, "");
    } catch (_error) {
      return "";
    }
  }

  function isFindWorkPage(value) {
    return /^\/nx\/find-work\/\d+$/.test(pagePath(value));
  }

  function resolveSearch(pageUrl, activeSavedSearchName) {
    const suppliedName = normalizeText(activeSavedSearchName);
    const approved = APPROVED_SEARCHES[suppliedName];
    const path = pagePath(pageUrl);
    if (approved && isFindWorkPage(pageUrl)) {
      return {...approved, savedSearchName: suppliedName, path};
    }
    const legacyName = LEGACY_SEARCHES_BY_PATH[path];
    const legacy = legacyName ? APPROVED_SEARCHES[legacyName] : null;
    return legacy ? {...legacy, savedSearchName: legacyName, path} : null;
  }

  function missingReceiver(error) {
    const message = error instanceof Error ? error.message : String(error || "");
    return /receiving end does not exist|could not establish connection|message port closed/i.test(message);
  }

  function loginOrChallengePage(value) {
    return /upwork\.com\/(?:ab\/account-security|login|signup|nx\/signup|auth|captcha)|cloudflare/i.test(String(value || ""));
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

  async function storeResult(pageUrl, search, response, error = "") {
    await chrome.storage.local.set({
      codistan_upwork_last_capture: {
        at: new Date().toISOString(),
        page_url: pageUrl,
        segment: search?.segment || "",
        profile_owner: search?.owner || "",
        saved_search_name: search?.savedSearchName || "",
        response: response || null,
        error
      }
    }).catch(() => {});
  }

  async function storeSchedulerStatus(status) {
    await chrome.storage.local.set({codistan_upwork_scheduler_status: status}).catch(() => {});
  }

  async function submitCards({pageUrl, pageTitle, activeSavedSearchName, cards, trigger, tabId}) {
    const search = resolveSearch(pageUrl, activeSavedSearchName);
    if (!search) {
      throw new Error("This Upwork page is not one of the three approved saved searches.");
    }
    if (!Array.isArray(cards) || cards.length === 0) throw new Error("No visible Upwork job cards were detected.");

    const response = await request("/capture", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        source: "upwork",
        source_subtype: "saved_search_card",
        parser_version: PARSER_VERSION,
        page_url: pageUrl,
        page_identity: `${search.owner} — ${search.savedSearchName}`,
        external_action_performed: false,
        records: cards.slice(0, MAX_RECORDS).map(card => ({
          ...card,
          raw_evidence: {
            ...(card.raw_evidence || {}),
            saved_search_path: search.path,
            saved_search_name: search.savedSearchName,
            profile_owner: search.owner,
            segment: search.segment,
            page_title: String(pageTitle || ""),
            capture_trigger: String(trigger || "automatic_visible_page")
          }
        }))
      })
    });

    if (tabId) await updateBadge(tabId, response.accepted > 0 ? String(response.accepted) : "✓", response.accepted > 0 ? "#157347" : "#5f6368");
    await storeResult(pageUrl, search, response);
    return {...response, saved_search_name: search.savedSearchName, profile_owner: search.owner};
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

  async function readVisibleCards(tabId, limit = MAX_RECORDS) {
    const result = await sendToTab(tabId, {type: "CODISTAN_CAPTURE_VISIBLE_UPWORK_CARDS", limit});
    if (!result?.ok) throw new Error(result?.error || "Upwork visible-card extraction failed.");
    return result;
  }

  function mergeCard(existing, incoming) {
    if (!existing) return incoming;
    const existingBody = String(existing.body || "");
    const incomingBody = String(incoming.body || "");
    const existingTitle = String(existing.title || "");
    const incomingTitle = String(incoming.title || "");
    return {
      ...existing,
      ...incoming,
      title: incomingTitle.length >= existingTitle.length ? incoming.title : existing.title,
      body: incomingBody.length >= existingBody.length ? incoming.body : existing.body,
      commercial_evidence: {...(existing.commercial_evidence || {}), ...(incoming.commercial_evidence || {})},
      raw_evidence: {...(existing.raw_evidence || {}), ...(incoming.raw_evidence || {})}
    };
  }

  function addCards(cardMap, cards) {
    const before = cardMap.size;
    for (const card of Array.isArray(cards) ? cards : []) {
      const key = String(card.source_native_id || card.source_url || "").trim();
      if (!key) continue;
      cardMap.set(key, mergeCard(cardMap.get(key), card));
      if (cardMap.size >= MAX_RECORDS) break;
    }
    return cardMap.size - before;
  }

  async function scanUpworkTab(tab, search, trigger) {
    if (!tab?.id) throw new Error("The Upwork saved-search tab is unavailable.");
    const status = await sendToTab(tab.id, {type: "CODISTAN_UPWORK_SCROLL_STATUS"});
    if (!status?.ok) throw new Error(status?.error || "The Upwork scroll controller is unavailable.");
    const originalTop = Number(status.top || 0);
    const cardMap = new Map();
    let latestResult = await readVisibleCards(tab.id, MAX_RECORDS);
    addCards(cardMap, latestResult.cards);
    let scrollSteps = 0;
    let noGrowthRounds = 0;
    let stopReason = "scroll_limit";
    let scrollContainer = String(status.scroller || "unknown");

    try {
      for (let step = 0; step < MAX_SCROLL_STEPS && cardMap.size < MAX_RECORDS; step += 1) {
        const scrollResult = await sendToTab(tab.id, {
          type: "CODISTAN_SCROLL_UPWORK_RESULTS",
          wait_ms: SCROLL_WAIT_MS
        });
        if (!scrollResult?.ok) throw new Error(scrollResult?.error || "Upwork result scrolling failed.");
        scrollContainer = String(scrollResult.scroller || scrollContainer);
        if (!scrollResult.moved) {
          stopReason = scrollResult.reason || "end_of_results";
          break;
        }
        scrollSteps += 1;
        latestResult = await readVisibleCards(tab.id, MAX_RECORDS);
        const added = addCards(cardMap, latestResult.cards);
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
      await sendToTab(tab.id, {type: "CODISTAN_RESTORE_UPWORK_SCROLL", top: originalTop}).catch(() => {});
    }

    const cards = [...cardMap.values()].slice(0, MAX_RECORDS);
    if (cards.length === 0) {
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

    const response = await submitCards({
      pageUrl: latestResult.page_url || tab.url || search.url,
      pageTitle: latestResult.page_title || tab.title || "",
      activeSavedSearchName: search.savedSearchName,
      cards,
      trigger,
      tabId: tab.id
    });
    return {
      ...response,
      record_count: cards.length,
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
        reject(new Error("Upwork saved-search page did not finish loading in time."));
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
      if (!tabId) throw new Error("Chrome did not create the approved Upwork saved-search tab.");
      scheduledTabIds.add(tabId);
      let tab = await waitForTabComplete(tabId);
      await sleep(PAGE_SETTLE_MS);
      tab = await chrome.tabs.get(tabId);
      const currentUrl = String(tab.url || "");
      if (loginOrChallengePage(currentUrl)) {
        throw new Error("Upwork requires the normal Chrome session to be signed in or manually verified before scheduled capture can run.");
      }
      if (pagePath(currentUrl) !== search.path) {
        throw new Error("Upwork redirected the approved saved search to an unexpected page.");
      }
      const result = await scanUpworkTab(tab, search, "approved_saved_search_cycle");
      return {id: search.id, label: search.savedSearchName, profile_owner: search.owner, ok: true, ...result};
    } catch (error) {
      return {
        id: search.id,
        label: search.savedSearchName,
        profile_owner: search.owner,
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      };
    } finally {
      if (tabId) {
        scheduledTabIds.delete(tabId);
        await chrome.tabs.remove(tabId).catch(() => {});
      }
    }
  }

  async function initializeSchedulerPolicy() {
    const stored = await chrome.storage.local.get([
      "codistan_upwork_scheduler_policy_version",
      "codistan_upwork_scheduler_enabled"
    ]);
    if (stored.codistan_upwork_scheduler_policy_version !== SCHEDULE_POLICY_VERSION) {
      await chrome.storage.local.set({
        codistan_upwork_scheduler_policy_version: SCHEDULE_POLICY_VERSION,
        codistan_upwork_scheduler_enabled: false
      });
      await chrome.alarms.clear(SCHEDULE_ALARM);
      return false;
    }
    return stored.codistan_upwork_scheduler_enabled === true;
  }

  async function schedulerEnabled() {
    await initializeSchedulerPolicy();
    const stored = await chrome.storage.local.get("codistan_upwork_scheduler_enabled");
    return stored.codistan_upwork_scheduler_enabled === true;
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

  async function runScheduledCycle(trigger = "alarm", allowWhenDisabled = false) {
    if (scheduledRun) return scheduledRun;
    scheduledRun = (async () => {
      const startedAt = new Date().toISOString();
      const enabled = await schedulerEnabled();
      const status = {
        running: true,
        trigger,
        enabled,
        manual_first_protection: true,
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
        if (!enabled && !allowWhenDisabled) {
          status.last_error = "Routine Upwork scheduling is disabled until the manual pilot is reviewed and explicitly enabled.";
          return status;
        }
        await request("/health");
        for (const search of APPROVED_SEARCH_LIST) {
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
    if (!isFindWorkPage(pageUrl) || scheduledTabIds.has(tabId)) return;
    try {
      const result = await readVisibleCards(tabId, 10);
      if (!Array.isArray(result.cards) || result.cards.length === 0) {
        if (attempt < 3) {
          setTimeout(() => autoCaptureTab(tabId, tab, attempt + 1), 4500);
          return;
        }
        throw new Error(result?.error || "The saved-search cards did not finish loading.");
      }
      await submitCards({
        pageUrl: result.page_url || pageUrl,
        pageTitle: result.page_title || tab.title || "",
        activeSavedSearchName: result.active_saved_search_name || "",
        cards: result.cards,
        trigger: "normal_chrome_saved_search_loaded",
        tabId
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await updateBadge(tabId, "!", "#b3261e");
      await storeResult(pageUrl, resolveSearch(pageUrl, ""), null, message);
    }
  }

  function scheduleAutoCapture(tabId, tab) {
    const pageUrl = String(tab?.url || "");
    if (!isFindWorkPage(pageUrl) || scheduledTabIds.has(tabId)) return;
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

  chrome.runtime.onInstalled.addListener(() => {
    initializeSchedulerPolicy().then(ensureSchedule).catch(() => {});
  });

  chrome.runtime.onStartup.addListener(() => {
    ensureSchedule().catch(() => {});
  });

  chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm.name === SCHEDULE_ALARM) runScheduledCycle("alarm", false).catch(() => {});
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    const url = String(changeInfo.url || tab.url || "");
    if (!isFindWorkPage(url) || scheduledTabIds.has(tabId)) return;
    if (changeInfo.status === "complete" || Boolean(changeInfo.url)) scheduleAutoCapture(tabId, {...tab, url});
  });

  chrome.tabs.onActivated.addListener(async ({tabId}) => {
    try {
      if (scheduledTabIds.has(tabId)) return;
      const tab = await chrome.tabs.get(tabId);
      if (isFindWorkPage(String(tab.url || ""))) scheduleAutoCapture(tabId, tab);
    } catch (_error) {
      // The tab may have closed before inspection.
    }
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message) return false;
    if (message.type === "CODISTAN_SUBMIT_UPWORK_CARDS") {
      (async () => {
        const pageUrl = String(message.page_url || sender.tab?.url || "");
        const response = await submitCards({
          pageUrl,
          pageTitle: String(message.page_title || sender.tab?.title || ""),
          activeSavedSearchName: String(message.active_saved_search_name || ""),
          cards: message.cards,
          trigger: String(message.trigger || "manual_extension_fallback"),
          tabId: sender.tab?.id
        });
        sendResponse({ok: true, ...response});
      })().catch(async error => {
        const tabId = sender.tab?.id;
        if (tabId) await updateBadge(tabId, "!", "#b3261e");
        const pageUrl = String(message.page_url || sender.tab?.url || "");
        await storeResult(pageUrl, resolveSearch(pageUrl, message.active_saved_search_name), null, error instanceof Error ? error.message : String(error));
        sendResponse({ok: false, error: error instanceof Error ? error.message : String(error)});
      });
      return true;
    }
    if (message.type === "CODISTAN_RUN_UPWORK_APPROVED_SEARCHES_NOW") {
      runScheduledCycle("manual_run_all_approved_searches", true)
        .then(result => sendResponse({ok: true, ...result}))
        .catch(error => sendResponse({ok: false, error: error instanceof Error ? error.message : String(error)}));
      return true;
    }
    if (message.type === "CODISTAN_GET_UPWORK_AUTOMATION_STATUS") {
      Promise.all([
        schedulerEnabled(),
        chrome.storage.local.get("codistan_upwork_scheduler_status")
      ]).then(([enabled, stored]) => sendResponse({
        ok: true,
        enabled,
        manual_first_protection: true,
        interval_minutes: SCHEDULE_INTERVAL_MINUTES,
        searches: APPROVED_SEARCH_LIST.map(({id, savedSearchName, owner}) => ({id, label: savedSearchName, profile_owner: owner})),
        status: stored.codistan_upwork_scheduler_status || null
      })).catch(error => sendResponse({ok: false, error: error instanceof Error ? error.message : String(error)}));
      return true;
    }
    if (message.type === "CODISTAN_SET_UPWORK_AUTOMATION") {
      (async () => {
        const enabled = message.enabled === true;
        await chrome.storage.local.set({
          codistan_upwork_scheduler_policy_version: SCHEDULE_POLICY_VERSION,
          codistan_upwork_scheduler_enabled: enabled
        });
        await ensureSchedule();
        sendResponse({ok: true, enabled, interval_minutes: SCHEDULE_INTERVAL_MINUTES});
      })().catch(error => sendResponse({ok: false, error: error instanceof Error ? error.message : String(error)}));
      return true;
    }
    return false;
  });

  ensureSchedule().catch(() => {});
})();
