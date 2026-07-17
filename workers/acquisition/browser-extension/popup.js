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
      const result = await chrome.tabs.sendMessage(tab.id, {
        type: "CODISTAN_CAPTURE_VISIBLE_UPWORK_CARDS",
        limit: 10
      });
      if (!result || !result.ok || !Array.isArray(result.cards) || result.cards.length === 0) {
        throw new Error(result?.error || "No visible Upwork job cards were detected.");
      }
      const response = await chrome.runtime.sendMessage({
        type: "CODISTAN_SUBMIT_UPWORK_CARDS",
        page_url: result.page_url,
        page_title: result.page_title,
        cards: result.cards,
        trigger: "manual_extension_fallback"
      });
      if (!response || !response.ok) throw new Error(response?.error || "Capture failed.");
      setStatus(`${response.saved_search_name || "Approved search"}: captured ${response.accepted || 0} new job(s). Current report: ${response.total_extracted || 0} opportunities.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      captureButton.disabled = false;
    }
  });

  Promise.all([
    fetch(`${COLLECTOR}/status`).then(response => response.json()),
    chrome.storage.local.get("codistan_last_capture")
  ]).then(([service, stored]) => {
    const last = stored.codistan_last_capture;
    const parts = [
      `Processor ready. Current report: ${service.extracted || 0} opportunities.`
    ];
    if (last?.error) parts.push(`Last capture issue: ${last.error}`);
    else if (last?.at) {
      const label = last.saved_search_name ? `${last.profile_owner || "Profile"}: ${last.saved_search_name}` : "Approved search";
      parts.push(`Last capture: ${label} at ${new Date(last.at).toLocaleString()}.`);
    }
    setStatus(parts.join(" "));
  }).catch(() => setStatus("The local Codistan capture processor is not running."));
})();