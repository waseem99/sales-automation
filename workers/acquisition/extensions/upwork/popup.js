(() => {
  "use strict";

  const COLLECTOR = "http://127.0.0.1:8765";
  const captureButton = document.getElementById("capture");
  const statusNode = document.getElementById("status");

  function setStatus(message) {
    statusNode.textContent = message;
  }

  async function activeTab() {
    const tabs = await chrome.tabs.query({active: true, currentWindow: true});
    if (!tabs.length || !tabs[0].id) throw new Error("No active browser tab was found.");
    return tabs[0];
  }

  captureButton.addEventListener("click", async () => {
    captureButton.disabled = true;
    setStatus("Reading visible jobs from this approved saved search…");
    try {
      const tab = await activeTab();
      const result = await chrome.tabs.sendMessage(tab.id, {type: "CODISTAN_CAPTURE_VISIBLE_UPWORK_CARDS", limit: 10});
      if (!result?.ok || !Array.isArray(result.cards) || result.cards.length === 0) {
        throw new Error(result?.error || "No visible Upwork job cards were detected.");
      }
      if (!result.active_saved_search_name) {
        throw new Error("Select one of the three approved saved-search chips, wait for its jobs to load, then capture again.");
      }
      const response = await chrome.runtime.sendMessage({
        type: "CODISTAN_SUBMIT_UPWORK_CARDS",
        page_url: result.page_url,
        page_title: result.page_title,
        active_saved_search_name: result.active_saved_search_name,
        cards: result.cards,
        trigger: "manual_extension_fallback"
      });
      if (!response?.ok) throw new Error(response?.error || "Capture failed.");
      const priorities = response.priority_counts || {};
      setStatus(`${response.saved_search_name || "Approved search"}: ${response.accepted || 0} new, ${response.duplicates || 0} duplicate, ${response.enriched || 0} enriched. Queue totals — A: ${priorities.priority_a || 0}; B: ${priorities.priority_b || 0}; Research: ${priorities.research || 0}; Reject: ${priorities.reject || 0}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      captureButton.disabled = false;
    }
  });

  Promise.all([
    fetch(`${COLLECTOR}/health`).then(response => response.json()),
    chrome.storage.local.get("codistan_upwork_last_capture")
  ]).then(([service, stored]) => {
    const last = stored.codistan_upwork_last_capture;
    const priorities = service.priority_counts || {};
    const parts = [`Processor ready. Jobs: ${service.accepted || 0}; enriched: ${service.enriched || 0}; A: ${priorities.priority_a || 0}; B: ${priorities.priority_b || 0}.`];
    if (last?.error) parts.push(`Last capture issue: ${last.error}`);
    else if (last?.at) parts.push(`Last capture: ${last.saved_search_name || "approved search"} at ${new Date(last.at).toLocaleString()}.`);
    setStatus(parts.join(" "));
  }).catch(() => setStatus("The local Upwork collector is not running on port 8765."));
})();
