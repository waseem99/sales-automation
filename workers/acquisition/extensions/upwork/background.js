(() => {
  "use strict";

  const COLLECTOR = "http://127.0.0.1:8765";
  const PARSER_VERSION = "upwork-extension-1.0.0";
  const SEARCHES = {
    "/nx/find-work/9652811": {segment: "ai-jobs", owner: "Waseem", savedSearchName: "AI + Fullstack AI 16 July 2026"},
    "/nx/find-work/9652860": {segment: "roshana-2d-3d", owner: "Roshana", savedSearchName: "3D Design & Creatives 15 July 2026"},
    "/nx/find-work/9652877": {segment: "nadir-game-ar-vr", owner: "Nadir", savedSearchName: "Game & AR/VR 16 July 2026"}
  };
  const pendingTimers = new Map();
  const lastAttempts = new Map();

  function searchForUrl(value) {
    try {
      const url = new URL(value);
      if (!["upwork.com", "www.upwork.com"].includes(url.hostname)) return null;
      const path = url.pathname.replace(/\/$/, "");
      const search = SEARCHES[path];
      return search ? {...search, path} : null;
    } catch (_error) {
      return null;
    }
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

  async function submitCards({pageUrl, pageTitle, cards, trigger, tabId}) {
    const search = searchForUrl(pageUrl);
    if (!search) throw new Error("This is not one of the three approved Upwork saved searches.");
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
        records: cards.slice(0, 10).map(card => ({
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

  async function readVisibleCards(tabId, limit = 10) {
    return chrome.tabs.sendMessage(tabId, {type: "CODISTAN_CAPTURE_VISIBLE_UPWORK_CARDS", limit});
  }

  async function autoCaptureTab(tabId, tab, attempt = 1) {
    const pageUrl = String(tab?.url || "");
    const search = searchForUrl(pageUrl);
    if (!search) return;
    try {
      const result = await readVisibleCards(tabId, 10);
      if (!result?.ok || !Array.isArray(result.cards) || result.cards.length === 0) {
        if (attempt < 3) {
          setTimeout(() => autoCaptureTab(tabId, tab, attempt + 1), 4500);
          return;
        }
        throw new Error(result?.error || "The saved-search cards did not finish loading.");
      }
      await submitCards({
        pageUrl: result.page_url || pageUrl,
        pageTitle: result.page_title || tab.title || "",
        cards: result.cards,
        trigger: "normal_chrome_saved_search_loaded",
        tabId
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await updateBadge(tabId, "!", "#b3261e");
      await storeResult(pageUrl, search, null, message);
    }
  }

  function scheduleAutoCapture(tabId, tab) {
    const pageUrl = String(tab?.url || "");
    if (!searchForUrl(pageUrl)) return;
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

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    const url = String(changeInfo.url || tab.url || "");
    if (!searchForUrl(url)) return;
    if (changeInfo.status === "complete" || Boolean(changeInfo.url)) scheduleAutoCapture(tabId, {...tab, url});
  });

  chrome.tabs.onActivated.addListener(async ({tabId}) => {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (searchForUrl(String(tab.url || ""))) scheduleAutoCapture(tabId, tab);
    } catch (_error) {
      // The tab may have closed before inspection.
    }
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.type !== "CODISTAN_SUBMIT_UPWORK_CARDS") return false;
    (async () => {
      const pageUrl = String(message.page_url || sender.tab?.url || "");
      const response = await submitCards({
        pageUrl,
        pageTitle: String(message.page_title || sender.tab?.title || ""),
        cards: message.cards,
        trigger: String(message.trigger || "manual_extension_fallback"),
        tabId: sender.tab?.id
      });
      sendResponse({ok: true, ...response});
    })().catch(async error => {
      const tabId = sender.tab?.id;
      if (tabId) await updateBadge(tabId, "!", "#b3261e");
      const pageUrl = String(message.page_url || sender.tab?.url || "");
      await storeResult(pageUrl, searchForUrl(pageUrl), null, error instanceof Error ? error.message : String(error));
      sendResponse({ok: false, error: error instanceof Error ? error.message : String(error)});
    });
    return true;
  });
})();
