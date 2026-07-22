(() => {
  "use strict";

  const COLLECTOR = "http://127.0.0.1:8775";
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
    setStatus("Reviewing visible LinkedIn posts for direct service requirements…");
    try {
      const tab = await activeTab();
      const result = await chrome.tabs.sendMessage(tab.id, {type: "CODISTAN_CAPTURE_VISIBLE_LINKEDIN_POSTS", limit: 20});
      if (!result?.ok) throw new Error(result?.error || "Visible-post capture failed.");
      if (!Array.isArray(result.records) || result.records.length === 0) {
        setStatus("No direct supported service requirements were found on the visible page.");
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
      setStatus(`${response.accepted || 0} new requirement(s), ${response.duplicates || 0} duplicate. Total stored: ${response.total_records || 0}.`);
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
    const parts = [`Processor ready. Stored requirements: ${service.accepted || 0}.`];
    if (last?.error) parts.push(`Last capture issue: ${last.error}`);
    else if (last?.at) parts.push(`Last capture at ${new Date(last.at).toLocaleString()}.`);
    setStatus(parts.join(" "));
  }).catch(() => setStatus("The local LinkedIn collector is not running on port 8775."));
})();
