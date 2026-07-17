(() => {
  "use strict";

  const COLLECTOR = "http://127.0.0.1:8765";
  const SEARCHES = {
    "/nx/find-work/9652811": "ai-jobs",
    "/nx/find-work/9652860": "roshana-2d-3d",
    "/nx/find-work/9652877": "nadir-game-ar-vr"
  };

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

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.type !== "CODISTAN_SUBMIT_UPWORK_CARDS") return false;

    (async () => {
      const pageUrl = String(message.page_url || sender.tab?.url || "");
      const segment = segmentForUrl(pageUrl);
      if (!segment) {
        throw new Error("This is not one of the three approved Upwork saved searches.");
      }
      if (!Array.isArray(message.cards) || message.cards.length === 0) {
        throw new Error("No visible Upwork job cards were detected.");
      }

      const response = await postJson("/capture", {
        segment,
        page_url: pageUrl,
        page_title: String(message.page_title || sender.tab?.title || ""),
        cards: message.cards.slice(0, 10),
        trigger: String(message.trigger || "automatic_visible_page")
      });

      const tabId = sender.tab?.id;
      if (tabId) {
        await updateBadge(tabId, response.accepted > 0 ? String(response.accepted) : "✓", response.accepted > 0 ? "#157347" : "#5f6368");
      }

      const priorityA = Number(response.accepted_priority_counts?.A || 0);
      await notifyPriorityA(priorityA, response.report_path);
      await chrome.storage.local.set({
        codistan_last_capture: {
          at: new Date().toISOString(),
          page_url: pageUrl,
          segment,
          response
        }
      });
      sendResponse({ok: true, ...response});
    })().catch(async error => {
      const tabId = sender.tab?.id;
      if (tabId) await updateBadge(tabId, "!", "#b3261e");
      const messageText = error instanceof Error ? error.message : String(error);
      await chrome.storage.local.set({
        codistan_last_capture: {
          at: new Date().toISOString(),
          page_url: String(message.page_url || sender.tab?.url || ""),
          error: messageText
        }
      }).catch(() => {});
      sendResponse({ok: false, error: messageText});
    });

    return true;
  });
})();
