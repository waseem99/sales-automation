(() => {
  "use strict";

  const COLLECTOR = "http://127.0.0.1:8765";
  const JOBS_PER_CAPTURE = 5;
  const captureButton = document.getElementById("capture");
  const finishButton = document.getElementById("finish");
  const segmentSelect = document.getElementById("segment");
  const statusNode = document.getElementById("status");

  function setBusy(busy) {
    captureButton.disabled = busy;
    finishButton.disabled = busy;
  }

  function setStatus(message) {
    statusNode.textContent = message;
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

  async function activeTab() {
    const tabs = await chrome.tabs.query({active: true, currentWindow: true});
    if (!tabs.length || !tabs[0].id) throw new Error("No active browser tab was found.");
    const tab = tabs[0];
    if (!tab.url || !tab.url.startsWith("https://www.upwork.com/")) {
      throw new Error("Open an Upwork saved-search results page first.");
    }
    return tab;
  }

  captureButton.addEventListener("click", async () => {
    setBusy(true);
    setStatus(`Reading up to ${JOBS_PER_CAPTURE} visible job cards on this page…`);
    try {
      const tab = await activeTab();
      const result = await chrome.tabs.sendMessage(tab.id, {
        type: "CODISTAN_CAPTURE_VISIBLE_UPWORK_CARDS",
        limit: JOBS_PER_CAPTURE
      });
      if (!result || !result.ok) {
        throw new Error(result && result.error ? result.error : "The Upwork page could not be read.");
      }
      if (!Array.isArray(result.cards) || result.cards.length === 0) {
        throw new Error("No visible Upwork job cards were detected. Open a saved-search results page and wait for the cards to load.");
      }
      const response = await postJson("/capture", {
        segment: segmentSelect.value,
        page_url: result.page_url,
        page_title: result.page_title,
        cards: result.cards
      });
      if (response.auto_finished) {
        setStatus(`Pilot complete. Report created with ${response.total_extracted} records: ${response.priority_counts.A || 0} A, ${response.priority_counts.B || 0} B, ${response.priority_counts.C || 0} C.`);
        window.setTimeout(() => window.close(), 1800);
        return;
      }
      setStatus(`Captured ${response.accepted} new job(s). Total: ${response.total_extracted}. Remaining capacity: ${response.remaining_capacity}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  });

  finishButton.addEventListener("click", async () => {
    setBusy(true);
    setStatus("Creating the BD-priority qualification report…");
    try {
      const response = await postJson("/finish", {});
      setStatus(`Report created: ${response.total_extracted} records, ${response.priority_counts.A || 0} A, ${response.priority_counts.B || 0} B, ${response.priority_counts.C || 0} C.`);
      window.setTimeout(() => window.close(), 1600);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      setBusy(false);
    }
  });

  fetch(`${COLLECTOR}/status`)
    .then((response) => response.json())
    .then((data) => {
      if (data.finished) {
        setStatus("This capture session is complete. The report has already been created.");
        captureButton.disabled = true;
        finishButton.disabled = true;
        return;
      }
      setStatus(`Collector ready. Captured: ${data.extracted || 0}. Remaining capacity: ${data.remaining_capacity ?? data.max_jobs_total ?? 0}.`);
    })
    .catch(() => setStatus("Start the Codistan capture launcher before using this extension."));
})();
