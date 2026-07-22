(() => {
  "use strict";

  const COLLECTOR = "http://127.0.0.1:8775";
  const PARSER_VERSION = "linkedin-extension-1.0.0";
  const pendingTimers = new Map();
  const lastAttempts = new Map();

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
        records: records.slice(0, 20).map(record => ({
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

  async function readVisiblePosts(tabId, limit = 20) {
    return chrome.tabs.sendMessage(tabId, {type: "CODISTAN_CAPTURE_VISIBLE_LINKEDIN_POSTS", limit});
  }

  async function autoCaptureTab(tabId, tab, attempt = 1) {
    const pageUrl = String(tab?.url || "");
    if (!supportedPage(pageUrl)) return;
    try {
      const result = await readVisiblePosts(tabId, 20);
      if (!result?.ok) throw new Error(result?.error || "LinkedIn visible-post extraction failed.");
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
    if (!message || message.type !== "CODISTAN_SUBMIT_LINKEDIN_POSTS") return false;
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
  });
})();
