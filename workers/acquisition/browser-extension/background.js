(() => {
  "use strict";

  const COLLECTOR = "http://127.0.0.1:8765";
  const SEARCHES = {
    "/nx/find-work/9652811": "ai-jobs",
    "/nx/find-work/9652860": "roshana-2d-3d",
    "/nx/find-work/9652877": "nadir-game-ar-vr"
  };
  const pendingTimers = new Map();
  const lastAttempts = new Map();

  function segmentForUrl(value) {
    try {
      const url = new URL(value);
      if (!["upwork.com", "www.upwork.com"].includes(url.hostname)) return null;
      return SEARCHES[url.pathname.replace(/\/$/, "")] || null;
    } catch (_error) {
      return null;
    }
  }

  async function postJson(path, payload) {
    const response = await fetch(`${COLLECTOR}${path}`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || `Local collector returned ${response.status}`);
    }
    return data;
  }

  async function updateBadge(tabId, text, color) {
    try {
      await chrome.action.setBadgeBackgroundColor({tabId, color});
      await chrome.action.setBadgeText({tabId, text});
      if (text) {
        setTimeout(() => chrome.action.setBadgeText({tabId, text: ""}).catch(() => {}), 5000);
      }
    } catch (_error) {
      // Badge display is non-critical.
    }
  }

  async function notifyPriorityA(count, reportPath) {
    if (!count) return;
    try {
      await chrome.notifications.create({
        type: "basic",
        iconUrl: "icon128.svg",
        title: "Codistan Priority A opportunity",
        message: `${count} new Priority A Upwork opportunity${count === 1 ? "" : "ies"} captured. Review the latest local report.`,
        contextMessage: reportPath || ""
      });
    } catch (_error) {
      // Notification display is non-critical.
    }
  }

  async function storeResult(pageUrl, segment, response, error = "") {
    await chrome.storage.local.set({
      codistan_last_capture: {
        at: new Date().toISOString(),
        page_url: pageUrl,
        segment,
        response: response || null,
        error
      }
    }).catch(() => {});
  }

  async function submitCards({pageUrl, pageTitle, cards, trigger, tabId}) {
    const segment = segmentForUrl(pageUrl);
    if (!segment) {
      throw new Error("This is not one of the three approved Upwork saved searches.");
    }
    if (!Array.isArray(cards) || cards.length === 0) {
      throw new Error("No visible Upwork job cards were detected.");
    }

    const response = await postJson("/capture", {
      segment,
      page_url: pageUrl,
      page_title: String(pageTitle || ""),
      cards: cards.slice(0, 10),
      trigger: String(trigger || "automatic_visible_page")
    });

    if (tabId) {
      await updateBadge(tabId, response.accepted > 0 ? String(response.accepted) : "✓", response.accepted > 0 ? "#157347" : "#5f6368");
    }
    await notifyPriorityA(Number(response.accepted_priority_counts?.A || 0), response.report_path);
    await storeResult(pageUrl, segment, response);
    return response;
  }

  async function readVisibleCards(tabId, limit = 10) {
    return chrome.tabs.sendMessage(tabId, {
      type: "CODISTAN_CAPTURE_VISIBLE_UPWORK_CARDS",
      limit
    });
  }

  async function autoCaptureTab(tabId, tab, attempt = 1) {
    const pageUrl = String(tab?.url || "");
    const segment = segmentForUrl(pageUrl);
    if (!segment) return;

    try {
      const result = await readVisibleCards(tabId, 10);
      if (!result || !result.ok || !Array.isArray(result.cards) || result.cards.length === 0) {
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
      const messageText = error instanceof Error ? error.message : String(error);
      await updateBadge(tabId, "!", "#b3261e");
      await storeResult(pageUrl, segment, null, messageText);
    }
  }

  function scheduleAutoCapture(tabId, tab) {
    const pageUrl = String(tab?.url || "");
    if (!segmentForUrl(pageUrl)) return;

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
    if (!segmentForUrl(url)) return;
    if (changeInfo.status === "complete" || Boolean(changeInfo.url)) {
      scheduleAutoCapture(tabId, {...tab, url});
    }
  });

  chrome.tabs.onActivated.addListener(async ({tabId}) => {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (segmentForUrl(String(tab.url || ""))) scheduleAutoCapture(tabId, tab);
    } catch (_error) {
      // Tab may have closed before inspection.
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
      const messageText = error instanceof Error ? error.message : String(error);
      await storeResult(String(message.page_url || sender.tab?.url || ""), "", null, messageText);
      sendResponse({ok: false, error: messageText});
    });

    return true;
  });
})();
