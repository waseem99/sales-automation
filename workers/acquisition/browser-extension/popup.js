(() => {
  "use strict";

  const COLLECTOR = "http://127.0.0.1:8765";
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
    setStatus("Reading the visible job cards on this page…");
    try {
      const tab = await activeTab();
      const result = await chrome.tabs.sendMessage(tab.id, {
        type: "CODISTAN_CAPTURE_VISIBLE_UPWORK_CARDS",
        limit: 10
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
      setStatus(`Captured ${response.accepted} new job(s). Total qualified sample: ${response.total_extracted}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  });

  finishButton.addEventListener("click", async () => {
    setBusy(true);
    setStatus("Creating the local qualification report…");
    try {
      const response = await postJson("/finish", {});
      setStatus(`Report created with ${response.total_extracted} opportunity record(s). It will open automatically.`);
      window.setTimeout(() => window.close(), 1200);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      setBusy(false);
    }
  });

  fetch(`${COLLECTOR}/status`)
    .then((response) => response.json())
    .then((data) => setStatus(`Collector ready. Captured so far: ${data.extracted || 0}.`))
    .catch(() => setStatus("Start the Codistan capture launcher before using this extension."));
})();
