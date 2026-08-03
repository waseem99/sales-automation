(() => {
  "use strict";

  const COLLECTOR = "http://127.0.0.1:8765";
  const MAX_DETAIL_RECORDS = 5;
  const PAGE_SETTLE_MS = 4500;
  const BETWEEN_DETAIL_MS = 1800;
  const SEARCHES = [
    {name: "AI + Fullstack AI 16 July 2026", url: "https://www.upwork.com/nx/find-work/9652811"},
    {name: "3D Design & Creatives 15 July 2026", url: "https://www.upwork.com/nx/find-work/9652860"},
    {name: "Game & AR/VR 16 July 2026", url: "https://www.upwork.com/nx/find-work/9652877"}
  ];
  let activeRun = null;

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function waitForTab(tabId, timeout = 30000) {
    const initial = await chrome.tabs.get(tabId);
    if (initial.status === "complete") return initial;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        reject(new Error("The Upwork page did not finish loading."));
      }, timeout);
      const listener = (updatedId, info, tab) => {
        if (updatedId !== tabId || info.status !== "complete") return;
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve(tab);
      };
      chrome.tabs.onUpdated.addListener(listener);
    });
  }

  async function sendToTab(tabId, message, files) {
    try {
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error || "");
      if (!/receiving end does not exist|could not establish connection|message port closed/i.test(text)) throw error;
      await chrome.scripting.executeScript({target: {tabId}, files});
      await sleep(500);
      return chrome.tabs.sendMessage(tabId, message);
    }
  }

  function score(card) {
    const commercial = card?.commercial_evidence || {};
    let value = 0;
    const fixed = Number(commercial.fixed_budget_usd || 0);
    const hourly = Number(commercial.hourly_min_usd || commercial.hourly_max_usd || 0);
    if (fixed >= 10000) value += 40;
    else if (fixed >= 5000) value += 32;
    else if (fixed >= 2000) value += 22;
    else if (fixed >= 1000) value += 12;
    if (hourly >= 50) value += 30;
    else if (hourly >= 30) value += 22;
    else if (hourly >= 20) value += 14;
    if (commercial.payment_verified === true) value += 10;
    const proposals = String(commercial.proposals || "").toLowerCase();
    if (/less than|fewer than/.test(proposals)) value += 10;
    else if (/5\s+to\s+10/.test(proposals)) value += 8;
    const age = String(card?.posted_age || commercial.posted_age || "").toLowerCase();
    if (/minute|hour|\b[0-9]+h\b/.test(age)) value += 8;
    else if (/1 day|yesterday/.test(age)) value += 5;
    value += Math.min(10, String(card?.body || "").length / 500);
    return value;
  }

  async function readCandidates() {
    const byId = new Map();
    for (const search of SEARCHES) {
      let tabId = null;
      try {
        const tab = await chrome.tabs.create({url: search.url, active: false});
        tabId = tab.id || null;
        if (!tabId) continue;
        await waitForTab(tabId);
        await sleep(PAGE_SETTLE_MS);
        const result = await sendToTab(
          tabId,
          {type: "CODISTAN_CAPTURE_VISIBLE_UPWORK_CARDS", limit: 12},
          ["evidence.js", "scroll.js", "content.js", "detail.js"]
        );
        for (const card of Array.isArray(result?.cards) ? result.cards : []) {
          const id = String(card.source_native_id || "");
          if (!id) continue;
          const existing = byId.get(id);
          if (!existing || score(card) > score(existing)) byId.set(id, card);
        }
      } catch (_error) {
        // A failed search does not prevent bounded enrichment of other searches.
      } finally {
        if (tabId) await chrome.tabs.remove(tabId).catch(() => {});
      }
    }
    return [...byId.values()].sort((a, b) => score(b) - score(a)).slice(0, MAX_DETAIL_RECORDS);
  }

  async function enrichCandidate(candidate) {
    let tabId = null;
    try {
      const tab = await chrome.tabs.create({url: candidate.source_url, active: false});
      tabId = tab.id || null;
      if (!tabId) throw new Error("Chrome did not create the Upwork detail tab.");
      await waitForTab(tabId);
      await sleep(PAGE_SETTLE_MS);
      const current = await chrome.tabs.get(tabId);
      if (/upwork\.com\/(?:ab\/account-security|login|signup|auth|captcha)/i.test(String(current.url || ""))) {
        throw new Error("Upwork requires normal sign-in or verification.");
      }
      const detail = await sendToTab(
        tabId,
        {type: "CODISTAN_CAPTURE_UPWORK_JOB_DETAIL"},
        ["evidence.js", "detail.js"]
      );
      if (!detail?.ok || !detail.record) throw new Error(detail?.error || "Upwork detail extraction failed.");
      const response = await fetch(`${COLLECTOR}/capture`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
          source: "upwork",
          source_subtype: "job_detail_enrichment",
          parser_version: "upwork-extension-1.1.2",
          page_url: detail.record.source_url,
          page_identity: "Automated Upwork job-detail enrichment",
          external_action_performed: false,
          records: [detail.record]
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `Collector returned ${response.status}.`);
      return {ok: true, source_url: candidate.source_url, ...payload};
    } catch (error) {
      return {ok: false, source_url: candidate.source_url, error: error instanceof Error ? error.message : String(error)};
    } finally {
      if (tabId) await chrome.tabs.remove(tabId).catch(() => {});
    }
  }

  async function run() {
    if (activeRun) return activeRun;
    activeRun = (async () => {
      const startedAt = new Date().toISOString();
      const candidates = await readCandidates();
      const details = [];
      let accepted = 0;
      let duplicates = 0;
      let enriched = 0;
      let rejected = 0;
      for (const candidate of candidates) {
        const result = await enrichCandidate(candidate);
        details.push(result);
        accepted += Number(result.accepted || 0);
        duplicates += Number(result.duplicates || 0);
        enriched += Number(result.enriched || 0);
        rejected += Number(result.rejected || 0);
        await sleep(BETWEEN_DETAIL_MS);
      }
      return {
        ok: true,
        started_at: startedAt,
        completed_at: new Date().toISOString(),
        candidate_count: candidates.length,
        detail_enriched: enriched + accepted,
        accepted,
        duplicates,
        enriched,
        rejected,
        details
      };
    })().finally(() => {
      activeRun = null;
    });
    return activeRun;
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== "CODISTAN_RUN_UPWORK_DETAIL_ENRICHMENT_NOW") return false;
    run()
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ok: false, error: error instanceof Error ? error.message : String(error)}));
    return true;
  });
})();
