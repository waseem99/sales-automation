(() => {
  "use strict";

  const params = new URLSearchParams(location.search);
  const cycleId = String(params.get("cycle_id") || "").trim();
  const controllerPort = Number(params.get("controller_port") || 8795);

  async function message(payload) {
    return chrome.runtime.sendMessage(payload);
  }

  async function report(payload) {
    const response = await fetch(`http://127.0.0.1:${controllerPort}/event`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error(`Automation controller returned ${response.status}.`);
    return response.json();
  }

  async function makeTemporary() {
    const tab = await chrome.tabs.getCurrent().catch(() => null);
    if (tab?.id) await chrome.tabs.update(tab.id, {active: false}).catch(() => {});
  }

  async function closeSelf() {
    const tab = await chrome.tabs.getCurrent().catch(() => null);
    if (tab?.id) await chrome.tabs.remove(tab.id).catch(() => {});
    else window.close();
  }

  (async () => {
    await makeTemporary();
    if (!cycleId) throw new Error("Automation cycle ID is missing.");

    await message({type: "CODISTAN_SET_UPWORK_AUTOMATION", enabled: false}).catch(() => {});
    const capture = await message({type: "CODISTAN_RUN_UPWORK_APPROVED_SEARCHES_NOW"});
    let detail = {ok: true, detail_enriched: 0, accepted: 0, duplicates: 0, enriched: 0, rejected: 0};
    if (capture?.ok !== false) {
      detail = await message({type: "CODISTAN_RUN_UPWORK_DETAIL_ENRICHMENT_NOW"}).catch(error => ({
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      }));
    }

    const result = {
      ...(capture || {}),
      accepted: Number(capture?.accepted || 0) + Number(detail?.accepted || 0),
      duplicates: Number(capture?.duplicates || 0) + Number(detail?.duplicates || 0),
      enriched: Number(capture?.enriched || 0) + Number(detail?.enriched || 0),
      rejected: Number(capture?.rejected || 0) + Number(detail?.rejected || 0),
      detail_enriched: Number(detail?.detail_enriched || detail?.enriched || 0),
      detail_status: detail || null,
      last_error: [capture?.last_error, detail?.error].filter(Boolean).join("; ")
    };
    await report({
      source: "upwork",
      cycle_id: cycleId,
      ok: capture?.ok !== false,
      result
    });
  })().catch(async error => {
    await report({
      source: "upwork",
      cycle_id: cycleId || "missing",
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    }).catch(() => {});
  }).finally(() => {
    setTimeout(() => closeSelf().catch(() => {}), 500);
  });
})();
