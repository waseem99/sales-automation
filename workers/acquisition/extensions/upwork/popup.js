(() => {
  "use strict";

  const COLLECTOR = "http://127.0.0.1:8765";
  const captureButton = document.getElementById("capture");
  const runAllButton = document.getElementById("run-all");
  const automationToggle = document.getElementById("automation-enabled");
  const statusNode = document.getElementById("status");

  function setStatus(message) {
    statusNode.textContent = message;
  }

  function setBusy(busy) {
    captureButton.disabled = busy;
    runAllButton.disabled = busy;
    automationToggle.disabled = busy;
  }

  async function activeTab() {
    const tabs = await chrome.tabs.query({active: true, currentWindow: true});
    if (!tabs.length || !tabs[0].id) throw new Error("No active browser tab was found.");
    return tabs[0];
  }

  function captureSummary(response) {
    const priorities = response.priority_counts || {};
    return `${response.saved_search_name || "Approved search"}: ${response.accepted || 0} new, ${response.duplicates || 0} duplicate, ${response.enriched || 0} enriched. Queue totals — A: ${priorities.priority_a || 0}; B: ${priorities.priority_b || 0}; Research: ${priorities.research || 0}; Reject: ${priorities.reject || 0}.`;
  }

  function cycleSummary(result) {
    const searches = Array.isArray(result.searches) ? result.searches : [];
    const completed = searches.filter(search => search.ok).length;
    const failed = searches.length - completed;
    const lines = [
      `Approved-search run completed: ${completed}/${searches.length || 3} searches succeeded.`,
      `${result.accepted || 0} new, ${result.duplicates || 0} duplicate, ${result.enriched || 0} enriched, ${result.rejected || 0} rejected.`
    ];
    if (failed) lines.push(`${failed} search${failed === 1 ? "" : "es"} need attention.`);
    for (const search of searches) {
      if (search.ok) {
        lines.push(`${search.profile_owner || "Profile"}: ${search.record_count || 0} unique jobs, ${search.scroll_steps || 0} scroll steps, stop ${search.stop_reason || "complete"}.`);
      } else {
        lines.push(`${search.profile_owner || search.label || "Search"}: ${search.error || "failed"}`);
      }
    }
    if (result.last_error) lines.push(`Run issue: ${result.last_error}`);
    return lines.join("\n");
  }

  async function loadStatus() {
    try {
      const [service, stored, automation] = await Promise.all([
        fetch(`${COLLECTOR}/health`).then(response => response.json()),
        chrome.storage.local.get("codistan_upwork_last_capture"),
        chrome.runtime.sendMessage({type: "CODISTAN_GET_UPWORK_AUTOMATION_STATUS"})
      ]);
      if (!automation?.ok) throw new Error(automation?.error || "Automation status is unavailable.");
      automationToggle.checked = automation.enabled === true;
      const last = stored.codistan_upwork_last_capture;
      const priorities = service.priority_counts || {};
      const parts = [
        `Processor ready. Jobs: ${service.accepted || 0}; enriched: ${service.enriched || 0}; A: ${priorities.priority_a || 0}; B: ${priorities.priority_b || 0}.`,
        automation.enabled
          ? `Routine cycle enabled every ${automation.interval_minutes || 15} minutes.`
          : "Routine cycle disabled; manual all-search testing remains available."
      ];
      const cycle = automation.status;
      if (cycle?.running) parts.push(`A ${cycle.trigger || "scheduled"} cycle is running now.`);
      else if (cycle?.completed_at) parts.push(`Last all-search cycle: ${new Date(cycle.completed_at).toLocaleString()} — ${cycle.accepted || 0} new, ${cycle.duplicates || 0} duplicate, ${cycle.enriched || 0} enriched.`);
      if (cycle?.last_error) parts.push(`Last cycle issue: ${cycle.last_error}`);
      if (last?.error) parts.push(`Last page-capture issue: ${last.error}`);
      else if (last?.at) parts.push(`Last page capture: ${last.saved_search_name || "approved search"} at ${new Date(last.at).toLocaleString()}.`);
      setStatus(parts.join("\n"));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The local Upwork collector is not running on port 8765.");
    }
  }

  captureButton.addEventListener("click", async () => {
    setBusy(true);
    setStatus("Reading visible jobs from this approved saved search…");
    try {
      const tab = await activeTab();
      const result = await chrome.tabs.sendMessage(tab.id, {type: "CODISTAN_CAPTURE_VISIBLE_UPWORK_CARDS", limit: 30});
      if (!result?.ok || !Array.isArray(result.cards) || result.cards.length === 0) {
        throw new Error(result?.error || "No visible Upwork job cards were detected.");
      }
      if (!result.active_saved_search_name) {
        throw new Error("Open one of the three approved saved-search pages, wait for its jobs to load, then capture again.");
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
      setStatus(captureSummary(response));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  });

  runAllButton.addEventListener("click", async () => {
    setBusy(true);
    setStatus("Running the three approved Upwork searches sequentially. Temporary tabs will remain inactive and close automatically…");
    try {
      const result = await chrome.runtime.sendMessage({type: "CODISTAN_RUN_UPWORK_APPROVED_SEARCHES_NOW"});
      if (!result?.ok) throw new Error(result?.error || "The approved-search run failed.");
      setStatus(cycleSummary(result));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  });

  automationToggle.addEventListener("change", async () => {
    const requested = automationToggle.checked;
    automationToggle.disabled = true;
    setStatus(requested ? "Enabling the 15-minute approved-search cycle…" : "Disabling the scheduled Upwork cycle…");
    try {
      const response = await chrome.runtime.sendMessage({
        type: "CODISTAN_SET_UPWORK_AUTOMATION",
        enabled: requested
      });
      if (!response?.ok) throw new Error(response?.error || "The automation setting could not be saved.");
      automationToggle.checked = response.enabled === true;
      setStatus(response.enabled
        ? `Routine Upwork capture is enabled every ${response.interval_minutes || 15} minutes while logged-in Chrome is running.`
        : "Routine Upwork capture is disabled. Manual page and all-search runs remain available.");
    } catch (error) {
      automationToggle.checked = !requested;
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      automationToggle.disabled = false;
    }
  });

  loadStatus();
})();
