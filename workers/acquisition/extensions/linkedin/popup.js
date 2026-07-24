(() => {
  "use strict";

  const COLLECTOR = "http://127.0.0.1:8775";
  const captureButton = document.getElementById("capture");
  const statusNode = document.getElementById("status");

  function setStatus(message) {
    statusNode.textContent = message;
  }

  function diagnosticSummary(diagnostics = {}) {
    const containers = Number(diagnostics.visible_post_containers || 0);
    const marked = Number(diagnostics.adapter_marked_containers || 0);
    const readable = Number(diagnostics.posts_with_readable_text || 0);
    const classified = Number(diagnostics.classified_candidates || 0);
    const activityIds = Number(diagnostics.containers_with_activity_id || 0);
    const permalinkHints = Number(diagnostics.containers_with_permalink_hint || 0);
    const missingUrl = Number(diagnostics.missing_canonical_url || 0);
    const rejections = Object.entries(diagnostics.rejection_reasons || {})
      .filter(([, count]) => Number(count) > 0)
      .map(([reason, count]) => `${reason}: ${count}`)
      .join(", ");
    const parts = [`Scanned ${containers} visible containers (${marked} adapter cards); ${readable} readable posts; ${classified} buyer-intent matches.`];
    if (activityIds || permalinkHints) parts.push(`${activityIds} cards exposed activity IDs; ${permalinkHints} exposed permalink hints.`);
    if (missingUrl) parts.push(`${missingUrl} matched posts lacked a canonical permalink.`);
    if (missingUrl > 0 && classified > 0 && missingUrl === classified) {
      parts.push("LinkedIn hid every post link in this search view. Open the target post by clicking its timestamp, then capture from the individual post page.");
    }
    if (rejections) parts.push(`Filtered — ${rejections}.`);
    return parts.join(" ");
  }

  async function activeTab() {
    const tabs = await chrome.tabs.query({active: true, currentWindow: true});
    if (!tabs.length || !tabs[0].id) throw new Error("No active browser tab was found.");
    return tabs[0];
  }

  captureButton.addEventListener("click", async () => {
    captureButton.disabled = true;
    setStatus("Reviewing visible LinkedIn posts for direct service requirements…");
    try {
      const tab = await activeTab();
      const result = await chrome.tabs.sendMessage(tab.id, {type: "CODISTAN_CAPTURE_VISIBLE_LINKEDIN_POSTS", limit: 20});
      if (!result?.ok) throw new Error(result?.error || "Visible-post capture failed.");
      if (!Array.isArray(result.records) || result.records.length === 0) {
        setStatus(`No direct supported service requirements were captured. ${diagnosticSummary(result.diagnostics)}`);
        return;
      }
      const response = await chrome.runtime.sendMessage({
        type: "CODISTAN_SUBMIT_LINKEDIN_POSTS",
        page_url: result.page_url,
        page_title: result.page_title,
        records: result.records,
        trigger: "manual_extension_fallback"
      });
      if (!response?.ok) throw new Error(response?.error || "Capture failed.");
      const priorities = response.accepted_priority_counts || {};
      setStatus(`${response.accepted || 0} new, ${response.duplicates || 0} duplicate. Priority A: ${priorities.priority_a || 0}; Priority B: ${priorities.priority_b || 0}. ${diagnosticSummary(result.diagnostics)} Open Acquisition Review for outreach action.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      captureButton.disabled = false;
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