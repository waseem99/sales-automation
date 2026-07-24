(() => {
  "use strict";

  const COLLECTOR = "http://127.0.0.1:8775";
  const MAX_SCROLL_STEPS = 4;
  const MAX_RECORDS = 30;
  const SCROLL_WAIT_MS = 2500;
  const CONTENT_SCRIPT_FILES = ["signal.js", "dom-adapter.js", "search-resolver.js", "content.js"];
  const captureButton = document.getElementById("capture");
  const scanMoreButton = document.getElementById("scanMore");
  const statusNode = document.getElementById("status");

  function setStatus(message) {
    statusNode.textContent = message;
  }

  function setBusy(busy) {
    captureButton.disabled = busy;
    scanMoreButton.disabled = busy;
  }

  function sleep(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
  }

  function isLinkedInTab(tab) {
    try {
      const url = new URL(String(tab?.url || ""));
      return ["linkedin.com", "www.linkedin.com"].includes(url.hostname);
    } catch (_error) {
      return false;
    }
  }

  function missingReceiver(error) {
    const message = error instanceof Error ? error.message : String(error || "");
    return /receiving end does not exist|could not establish connection|message port closed/i.test(message);
  }

  async function injectCurrentScripts(tab) {
    if (!tab?.id || !isLinkedInTab(tab)) {
      throw new Error("Open a normal LinkedIn search, feed, or post page before running capture.");
    }
    await chrome.scripting.executeScript({
      target: {tabId: tab.id},
      files: CONTENT_SCRIPT_FILES
    });
    await sleep(350);
  }

  async function sendToTab(tab, message) {
    try {
      return await chrome.tabs.sendMessage(tab.id, message);
    } catch (error) {
      if (!missingReceiver(error)) throw error;
      setStatus("The LinkedIn tab was opened before the latest extension update. Repairing the tab and retrying…");
      await injectCurrentScripts(tab);
      try {
        return await chrome.tabs.sendMessage(tab.id, message);
      } catch (retryError) {
        throw new Error(`The LinkedIn tab could not be repaired automatically. Refresh this tab once and retry. ${retryError instanceof Error ? retryError.message : String(retryError)}`);
      }
    }
  }

  function diagnosticSummary(diagnostics = {}) {
    const containers = Number(diagnostics.visible_post_containers || 0);
    const marked = Number(diagnostics.adapter_marked_containers || 0);
    const readable = Number(diagnostics.posts_with_readable_text || 0);
    const classified = Number(diagnostics.classified_candidates || 0);
    const resolved = Number(diagnostics.candidate_urls || 0);
    const activityIds = Number(diagnostics.containers_with_activity_id || 0);
    const permalinkHints = Number(diagnostics.containers_with_permalink_hint || 0);
    const missingUrl = Number(diagnostics.missing_canonical_url || 0);
    const rejections = Object.entries(diagnostics.rejection_reasons || {})
      .filter(([, count]) => Number(count) > 0)
      .map(([reason, count]) => `${reason}: ${count}`)
      .join(", ");
    const parts = [`Scanned ${containers} visible containers (${marked} adapter cards); ${readable} readable posts; ${classified} buyer-intent matches; ${resolved} resolvable post links.`];
    if (activityIds || permalinkHints) parts.push(`${activityIds} cards exposed activity IDs; ${permalinkHints} exposed permalink hints.`);
    if (missingUrl) parts.push(`${missingUrl} matched posts lacked a canonical permalink.`);
    if (missingUrl > 0 && classified > 0 && missingUrl === classified) {
      parts.push("LinkedIn hid every post link in this view. The bounded scan will retry after loading additional result windows.");
    }
    if (rejections) parts.push(`Filtered — ${rejections}.`);
    return parts.join(" ");
  }

  async function activeTab() {
    const tabs = await chrome.tabs.query({active: true, currentWindow: true});
    if (!tabs.length || !tabs[0].id) throw new Error("No active browser tab was found.");
    if (!isLinkedInTab(tabs[0])) throw new Error("Open a LinkedIn content search, feed, or individual post before running capture.");
    return tabs[0];
  }

  async function readVisible(tab, limit = MAX_RECORDS) {
    await sendToTab(tab, {type: "CODISTAN_RESOLVE_LINKEDIN_LINKS"});
    await sleep(120);
    const result = await sendToTab(tab, {type: "CODISTAN_CAPTURE_VISIBLE_LINKEDIN_POSTS", limit});
    if (!result?.ok) throw new Error(result?.error || "Visible-post capture failed.");
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
      body: incomingBody.length >= existingBody.length ? incomingBody : existingBody,
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

  async function submitRecords(tab, pageResult, records, trigger) {
    const response = await chrome.runtime.sendMessage({
      type: "CODISTAN_SUBMIT_LINKEDIN_POSTS",
      page_url: pageResult.page_url || tab.url,
      page_title: pageResult.page_title || tab.title,
      records,
      trigger
    });
    if (!response?.ok) throw new Error(response?.error || "Capture failed.");
    return response;
  }

  captureButton.addEventListener("click", async () => {
    setBusy(true);
    setStatus("Reviewing visible LinkedIn posts for direct service requirements…");
    try {
      const tab = await activeTab();
      const result = await readVisible(tab, MAX_RECORDS);
      if (!Array.isArray(result.records) || result.records.length === 0) {
        setStatus(`No direct supported service requirements were captured. ${diagnosticSummary(result.diagnostics)}`);
        return;
      }
      const response = await submitRecords(tab, result, result.records, "manual_visible_page_capture");
      const priorities = response.accepted_priority_counts || {};
      setStatus(`${response.accepted || 0} new, ${response.duplicates || 0} duplicate. Priority A: ${priorities.priority_a || 0}; Priority B: ${priorities.priority_b || 0}. ${diagnosticSummary(result.diagnostics)} Open Acquisition Review for outreach action.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  });

  scanMoreButton.addEventListener("click", async () => {
    setBusy(true);
    setStatus("Scanning the current LinkedIn results and loading more visible cards…");
    let tab = null;
    let originalTop = 0;
    let initialScroller = "unknown";
    let latestScroller = "unknown";
    try {
      tab = await activeTab();
      const status = await sendToTab(tab, {type: "CODISTAN_LINKEDIN_SCROLL_STATUS"});
      if (!status?.ok) throw new Error(status?.error || "The LinkedIn scroll controller is unavailable.");
      originalTop = Number(status.top || 0);
      initialScroller = String(status.scroller_kind || "unknown");
      latestScroller = initialScroller;

      const recordMap = new Map();
      let latestResult = await readVisible(tab, MAX_RECORDS);
      addRecords(recordMap, latestResult.records);
      let scrollSteps = 0;
      let noGrowthRounds = 0;
      let stopReason = "scroll_limit";

      for (let step = 0; step < MAX_SCROLL_STEPS && recordMap.size < MAX_RECORDS; step += 1) {
        setStatus(`Loading more LinkedIn results — step ${step + 1} of ${MAX_SCROLL_STEPS}; ${recordMap.size} unique opportunities resolved so far…`);
        const scrollResult = await sendToTab(tab, {
          type: "CODISTAN_SCROLL_LINKEDIN_RESULTS",
          wait_ms: SCROLL_WAIT_MS
        });
        if (!scrollResult?.ok) throw new Error(scrollResult?.error || "LinkedIn result scrolling failed.");
        latestScroller = String(scrollResult.scroller_kind || latestScroller);
        if (!scrollResult.moved) {
          stopReason = scrollResult.at_end ? "end_of_results" : "no_movable_scroll_container";
          break;
        }
        scrollSteps += 1;
        latestResult = await readVisible(tab, MAX_RECORDS);
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

      const records = [...recordMap.values()].slice(0, MAX_RECORDS);
      const scanSummary = `Bounded scan completed: ${scrollSteps} scroll steps, ${records.length} unique resolvable opportunities, stop reason ${stopReason}, scroll container ${latestScroller} (initially ${initialScroller}).`;
      if (records.length === 0) {
        setStatus(`No direct supported service requirements were captured. ${scanSummary} ${diagnosticSummary(latestResult.diagnostics)}`);
        return;
      }
      const response = await submitRecords(tab, latestResult, records, "manual_bounded_scroll_scan");
      const priorities = response.accepted_priority_counts || {};
      setStatus(`${response.accepted || 0} new, ${response.duplicates || 0} duplicate, ${response.enriched || 0} enriched. Priority A: ${priorities.priority_a || 0}; Priority B: ${priorities.priority_b || 0}. ${scanSummary} Open Acquisition Review for outreach action.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      if (tab?.id) {
        await sendToTab(tab, {type: "CODISTAN_RESTORE_LINKEDIN_SCROLL", top: originalTop}).catch(() => {});
      }
      setBusy(false);
    }
  });

  Promise.all([
    fetch(`${COLLECTOR}/health`).then(response => response.json()),
    chrome.storage.local.get("codistan_linkedin_last_capture")
  ]).then(([service, stored]) => {
    const last = stored.codistan_linkedin_last_capture;
    const priorities = service.priority_counts || {};
    const parts = [`Processor ready. Requirements: ${service.accepted || 0}; A: ${priorities.priority_a || 0}; B: ${priorities.priority_b || 0}.`];
    if (last?.error) parts.push(`Last capture issue: ${last.error}`);
    else if (last?.at) parts.push(`Last capture at ${new Date(last.at).toLocaleString()}.`);
    setStatus(parts.join(" "));
  }).catch(() => setStatus("The local LinkedIn collector is not running on port 8775."));
})();