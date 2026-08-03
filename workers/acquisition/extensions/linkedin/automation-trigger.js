(() => {
  "use strict";

  const params = new URLSearchParams(location.search);
  const cycleId = String(params.get("cycle_id") || "").trim();
  const controllerPort = Number(params.get("controller_port") || 8795);
  const source = String(params.get("source") || "linkedin").trim();

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

    let result;
    if (source === "sales_navigator") {
      result = await message({type: "CODISTAN_RUN_SALES_NAV_CAMPAIGNS_NOW"});
      await message({type: "CODISTAN_SET_SALES_NAV_AUTOMATION", enabled: false}).catch(() => {});
    } else {
      await message({type: "CODISTAN_SET_LINKEDIN_AUTOMATION", enabled: true});
      result = await message({type: "CODISTAN_RUN_LINKEDIN_SCHEDULED_SCAN_NOW"});
      await message({type: "CODISTAN_SET_LINKEDIN_AUTOMATION", enabled: false}).catch(() => {});
    }

    await report({
      source,
      cycle_id: cycleId,
      ok: result?.ok !== false,
      result: result || {}
    });
  })().catch(async error => {
    await report({
      source,
      cycle_id: cycleId || "missing",
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    }).catch(() => {});
  }).finally(() => {
    setTimeout(() => closeSelf().catch(() => {}), 500);
  });
})();
