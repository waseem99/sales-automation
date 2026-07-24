(() => {
  "use strict";

  const STORAGE_KEY = "codistan_sales_nav_campaigns";
  let bypassNextSave = false;

  function list(value) {
    if (Array.isArray(value)) return [...new Set(value.map(item => String(item || "").trim()).filter(Boolean))];
    return [...new Set(String(value || "").split(/[\n,]/).map(item => item.trim()).filter(Boolean))];
  }

  function normalizedId(value) {
    return String(value || "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  }

  function value(id) {
    return String(document.getElementById(id)?.value || "").trim();
  }

  function checked(id) {
    return document.getElementById(id)?.checked === true;
  }

  async function persistCompleteCampaign() {
    const id = normalizedId(value("campaignSelect"));
    if (!id) return;
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const campaigns = Array.isArray(stored[STORAGE_KEY]) ? stored[STORAGE_KEY] : [];
    const existing = campaigns.find(campaign => campaign.id === id) || {};
    const campaign = {
      ...existing,
      id,
      enabled: checked("campaignEnabled"),
      state: checked("campaignEnabled") ? "active" : "on_hold",
      name: value("campaignName"),
      offer_id: normalizedId(value("offerId") || value("offerName")),
      offer_name: value("offerName"),
      route: value("campaignRoute") || "research_only",
      offer_type: value("offerType") || "service",
      offer_summary: value("offerSummary"),
      first_touch_angle: value("firstTouchAngle"),
      no_buyer_intent_warning: value("intentWarning") || "This is a cold ICP match. No explicit buying intent has been established.",
      service_route: value("serviceRoute") || "delivery_partner",
      service_lanes: list(value("serviceLanes")),
      target_industry_terms: list(value("industries")),
      target_company_types: list(value("companyTypes")),
      target_personas: list(value("personas")),
      target_seniority: list(value("seniority")),
      target_geographies: list(value("geographies")),
      positive_terms: list(value("positiveTerms")),
      search_urls: list(existing.search_urls),
      created_at: existing.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    const next = campaigns.filter(item => item.id !== id);
    next.push(campaign);
    await chrome.storage.local.set({[STORAGE_KEY]: next});
  }

  const button = document.getElementById("saveCampaign");
  button?.addEventListener("click", async event => {
    if (bypassNextSave) {
      bypassNextSave = false;
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    button.disabled = true;
    try {
      await persistCompleteCampaign();
      bypassNextSave = true;
      button.disabled = false;
      button.click();
    } catch (error) {
      button.disabled = false;
      const status = document.getElementById("status");
      if (status) status.textContent = error instanceof Error ? error.message : String(error);
    }
  }, true);
})();
