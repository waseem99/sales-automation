(() => {
  "use strict";

  const APPROVED_UPWORK_SEARCH_IDS = new Set(["9652811", "9652860", "9652877"]);
  const MANAGED_LINKEDIN_QUERIES = new Set([
    '("looking for" OR "seeking" OR "need recommendations for" OR "request for proposal" OR RFP) AND ("software development agency" OR "software development partner" OR "MVP development agency" OR "web app development agency") NOT hiring NOT "job opening" NOT recruiter NOT "join our team"',
    '("looking for" OR "seeking" OR "need recommendations for" OR "request for proposal" OR RFP) AND ("AI automation agency" OR "AI development partner" OR "AI implementation partner" OR "generative AI consultancy") NOT hiring NOT job NOT recruiter',
    '("looking for" OR "seeking" OR "need recommendations for" OR "request for proposal" OR RFP) AND ("digital marketing agency" OR "performance marketing agency" OR "SEO agency" OR "social media agency") NOT hiring NOT job NOT recruiter',
    '("looking for" OR "seeking" OR "need recommendations for" OR "request for proposal" OR RFP) AND ("video production agency" OR "animation studio" OR "3D visualization studio" OR "motion graphics agency") NOT hiring NOT job NOT recruiter',
    '("looking for" OR "seeking" OR "need recommendations for" OR "request for proposal" OR RFP OR "project-based engagement") AND ("cybersecurity consultancy" OR "security assessment firm" OR "ISO 27001 consultant" OR "SOC 2 consultant" OR "penetration testing company") NOT hiring NOT job NOT recruiter'
  ]);

  const params = new URLSearchParams(location.search);
  const mode = params.get("mode") === "close" ? "close" : "dedupe";
  const leadDeskUrl = normalizeUrl(params.get("leadDeskUrl") || "");
  const statusNode = document.getElementById("status");

  function normalizeUrl(value) {
    try {
      const url = new URL(String(value || ""));
      url.hash = "";
      const normalized = url.href;
      return url.protocol === "file:" ? normalized.toLowerCase() : normalized;
    } catch (_error) {
      return "";
    }
  }

  function categoryFor(tab) {
    const rawUrl = String(tab.url || tab.pendingUrl || "");
    const normalized = normalizeUrl(rawUrl);
    if (!normalized) return "";

    if (leadDeskUrl && normalized === leadDeskUrl) return "lead_desk";

    try {
      const url = new URL(rawUrl);
      const hostname = url.hostname.toLowerCase();
      const pathname = url.pathname.replace(/\/+$/, "") || "/";

      if (url.protocol === "chrome-extension:" && hostname === chrome.runtime.id) {
        if (pathname.endsWith("/workspace-governance.html")) return "governance";
        if (pathname.endsWith("/sales-nav-options.html")) return "sales_nav_campaigns";
      }

      if (hostname === "www.upwork.com") {
        const match = pathname.match(/^\/nx\/find-work\/(\d+)$/);
        if (match && APPROVED_UPWORK_SEARCH_IDS.has(match[1])) return "upwork";
      }

      if (hostname === "www.linkedin.com" && pathname === "/search/results/content") {
        const query = url.searchParams.get("keywords") || "";
        if (MANAGED_LINKEDIN_QUERIES.has(query)) return "linkedin";
      }
    } catch (_error) {
      return "";
    }
    return "";
  }

  function chooseRetainedTab(tabs) {
    return [...tabs].sort((left, right) => {
      if (left.active !== right.active) return left.active ? -1 : 1;
      if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
      return Number(right.lastAccessed || 0) - Number(left.lastAccessed || 0);
    })[0];
  }

  async function removeTabs(tabIds) {
    const unique = [...new Set(tabIds.filter(value => Number.isInteger(value)))];
    if (unique.length === 0) return 0;
    await chrome.tabs.remove(unique).catch(() => {});
    return unique.length;
  }

  async function run() {
    const current = await chrome.tabs.getCurrent();
    const allTabs = await chrome.tabs.query({});
    const categories = new Map();

    for (const tab of allTabs) {
      const category = categoryFor(tab);
      if (!category || category === "governance") continue;
      if (!categories.has(category)) categories.set(category, []);
      categories.get(category).push(tab);
    }

    const result = {
      mode,
      at: new Date().toISOString(),
      closed: 0,
      retained: {},
      unrelated_tabs_untouched: true
    };

    if (mode === "close") {
      const managedIds = [];
      for (const tabs of categories.values()) {
        for (const tab of tabs) managedIds.push(tab.id);
      }
      result.closed = await removeTabs(managedIds);
      statusNode.textContent = `Closed ${result.closed} Codistan-managed workspace tab(s).`;
    } else {
      const duplicateIds = [];
      for (const [category, tabs] of categories.entries()) {
        const retained = chooseRetainedTab(tabs);
        if (!retained) continue;
        result.retained[category] = retained.id;
        for (const tab of tabs) {
          if (tab.id !== retained.id) duplicateIds.push(tab.id);
        }
      }
      result.closed = await removeTabs(duplicateIds);

      const leadDeskTabId = result.retained.lead_desk;
      if (Number.isInteger(leadDeskTabId)) {
        const leadDeskTab = await chrome.tabs.get(leadDeskTabId).catch(() => null);
        if (leadDeskTab?.windowId) {
          await chrome.tabs.update(leadDeskTabId, {active: true}).catch(() => {});
          await chrome.windows.update(leadDeskTab.windowId, {focused: true}).catch(() => {});
        }
      }
      statusNode.textContent = `Workspace organized. Closed ${result.closed} duplicate managed tab(s).`;
    }

    await chrome.storage.local.set({codistan_workspace_governance_last_run: result}).catch(() => {});
    setTimeout(() => {
      if (current?.id) chrome.tabs.remove(current.id).catch(() => window.close());
      else window.close();
    }, 700);
  }

  run().catch(error => {
    statusNode.textContent = `Workspace governance could not complete: ${error instanceof Error ? error.message : String(error)}`;
  });
})();
