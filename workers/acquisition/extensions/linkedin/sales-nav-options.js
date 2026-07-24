(() => {
  "use strict";

  const elements = Object.fromEntries([
    "campaignSelect", "newCampaignId", "newCampaign", "duplicateCampaign", "campaignEnabled",
    "campaignName", "offerId", "offerName", "campaignRoute", "offerType", "offerSummary",
    "firstTouchAngle", "intentWarning", "serviceRoute", "serviceLanes", "industries",
    "companyTypes", "personas", "seniority", "geographies", "positiveTerms", "saveCampaign",
    "searchUrl", "registerSearch", "searchList", "automationEnabled", "runNow", "status"
  ].map(id => [id, document.getElementById(id)]));

  let campaigns = [];
  let selectedCampaignId = "";
  let automationStatus = null;

  function list(value) {
    if (Array.isArray(value)) return [...new Set(value.map(item => String(item || "").trim()).filter(Boolean))];
    return [...new Set(String(value || "").split(/[\n,]/).map(item => item.trim()).filter(Boolean))];
  }

  function lines(value) {
    return list(value).join("\n");
  }

  function normalizedId(value) {
    return String(value || "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  }

  function selectedCampaign() {
    return campaigns.find(campaign => campaign.id === selectedCampaignId) || campaigns[0] || null;
  }

  function setStatus(message) {
    elements.status.textContent = String(message || "");
  }

  function setBusy(busy) {
    for (const id of ["newCampaign", "duplicateCampaign", "saveCampaign", "registerSearch", "runNow"]) elements[id].disabled = busy;
    elements.automationEnabled.disabled = busy;
    elements.campaignSelect.disabled = busy;
  }

  function renderCampaignSelect() {
    const previous = selectedCampaignId;
    elements.campaignSelect.replaceChildren();
    for (const campaign of campaigns) {
      const option = document.createElement("option");
      option.value = campaign.id;
      option.textContent = `${campaign.name} · ${String(campaign.route || "cold campaign").replaceAll("_", " ")}${campaign.enabled === false ? " · paused" : ""}`;
      elements.campaignSelect.append(option);
    }
    selectedCampaignId = campaigns.some(campaign => campaign.id === previous)
      ? previous
      : campaigns.find(campaign => campaign.enabled !== false)?.id || campaigns[0]?.id || "";
    elements.campaignSelect.value = selectedCampaignId;
  }

  function renderForm() {
    const campaign = selectedCampaign();
    if (!campaign) return;
    elements.campaignEnabled.checked = campaign.enabled !== false;
    elements.campaignName.value = campaign.name || "";
    elements.offerId.value = campaign.offer_id || "";
    elements.offerName.value = campaign.offer_name || "";
    elements.campaignRoute.value = campaign.route || "direct_buyer";
    elements.offerType.value = campaign.offer_type || "hybrid";
    elements.offerSummary.value = campaign.offer_summary || "";
    elements.firstTouchAngle.value = campaign.first_touch_angle || "";
    elements.intentWarning.value = campaign.no_buyer_intent_warning || "This is a cold ICP match. No explicit buying intent has been established.";
    elements.serviceRoute.value = campaign.service_route || "software_product";
    elements.serviceLanes.value = list(campaign.service_lanes).join(", ");
    elements.industries.value = lines(campaign.target_industry_terms);
    elements.companyTypes.value = lines(campaign.target_company_types);
    elements.personas.value = lines(campaign.target_personas);
    elements.seniority.value = lines(campaign.target_seniority);
    elements.geographies.value = lines(campaign.target_geographies);
    elements.positiveTerms.value = lines(campaign.positive_terms);
    renderSearches(campaign);
    renderStatus();
  }

  function campaignFromForm(id = selectedCampaignId) {
    const existing = campaigns.find(campaign => campaign.id === id) || {};
    return {
      ...existing,
      id: normalizedId(id),
      enabled: elements.campaignEnabled.checked,
      state: elements.campaignEnabled.checked ? "active" : "on_hold",
      name: elements.campaignName.value.trim(),
      offer_id: normalizedId(elements.offerId.value || elements.offerName.value),
      offer_name: elements.offerName.value.trim(),
      route: elements.campaignRoute.value,
      offer_type: elements.offerType.value,
      offer_summary: elements.offerSummary.value.trim(),
      first_touch_angle: elements.firstTouchAngle.value.trim(),
      no_buyer_intent_warning: elements.intentWarning.value.trim() || "This is a cold ICP match. No explicit buying intent has been established.",
      service_route: elements.serviceRoute.value,
      service_lanes: list(elements.serviceLanes.value),
      target_industry_terms: list(elements.industries.value),
      target_company_types: list(elements.companyTypes.value),
      target_personas: list(elements.personas.value),
      target_seniority: list(elements.seniority.value),
      target_geographies: list(elements.geographies.value),
      positive_terms: list(elements.positiveTerms.value),
      search_urls: list(existing.search_urls),
      created_at: existing.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
  }

  function renderSearches(campaign) {
    elements.searchList.replaceChildren();
    const urls = list(campaign.search_urls);
    if (!urls.length) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = "No Sales Navigator searches are registered for this campaign.";
      elements.searchList.append(empty);
      return;
    }
    for (const url of urls) {
      const row = document.createElement("div");
      row.className = "search-item";
      const link = document.createElement("a");
      link.href = url;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = url;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "Remove";
      remove.addEventListener("click", () => removeSearch(campaign.id, url));
      row.append(link, remove);
      elements.searchList.append(row);
    }
  }

  function renderStatus() {
    const campaign = selectedCampaign();
    const status = automationStatus;
    const output = [];
    if (campaign) {
      output.push(campaign.name);
      output.push(`Route: ${String(campaign.route || "unknown").replaceAll("_", " ")}`);
      output.push(`Offer: ${campaign.offer_name || "Not defined"}`);
      output.push(`Registered searches: ${list(campaign.search_urls).length}`);
      output.push(campaign.enabled === false ? "Campaign is paused; searches and history are retained." : "Campaign is active.");
    }
    output.push(elements.automationEnabled.checked ? "Routine Sales Navigator scheduling is enabled." : "Routine scheduling is disabled; manual campaign runs remain available.");
    if (status?.running) output.push(`A ${status.trigger || "campaign"} run is active.`);
    if (status?.completed_at) {
      output.push(`Last completed: ${new Date(status.completed_at).toLocaleString()}`);
      output.push(`${status.accepted || 0} new, ${status.duplicates || 0} duplicate, ${status.enriched || 0} enriched, ${status.rejected || 0} rejected.`);
      const campaignStatus = Array.isArray(status.campaigns) ? status.campaigns.find(item => item.id === selectedCampaignId) : null;
      for (const search of campaignStatus?.searches || []) {
        if (search.ok) {
          const diagnostics = search.diagnostics || {};
          output.push(`Search: ${search.record_count || 0} prospects, ${search.scroll_steps || 0} scroll steps, stop ${search.stop_reason || "complete"}.`);
          output.push(`Visible lead links: ${diagnostics.visible_lead_links ?? "n/a"}; readable cards: ${diagnostics.readable_cards ?? "n/a"}; missing name: ${diagnostics.missing_name ?? 0}; missing role: ${diagnostics.missing_headline ?? 0}; missing company: ${diagnostics.missing_company ?? 0}.`);
        } else output.push(`Search issue: ${search.error || "failed"}`);
      }
    }
    if (status?.last_error) output.push(`Last run issue: ${status.last_error}`);
    setStatus(output.join("\n"));
  }

  async function load() {
    const response = await chrome.runtime.sendMessage({type: "CODISTAN_GET_SALES_NAV_CAMPAIGNS"});
    if (!response?.ok) throw new Error(response?.error || "Campaigns could not be loaded.");
    campaigns = Array.isArray(response.campaigns) ? response.campaigns : [];
    automationStatus = response.status || null;
    elements.automationEnabled.checked = response.enabled === true;
    renderCampaignSelect();
    renderForm();
  }

  async function saveCampaign(campaign) {
    if (!campaign.id || !campaign.name || !campaign.offer_name) throw new Error("Campaign ID, campaign name and offer name are required.");
    if (!campaign.route) throw new Error("Campaign route is required.");
    const response = await chrome.runtime.sendMessage({type: "CODISTAN_SAVE_SALES_NAV_CAMPAIGN", campaign});
    if (!response?.ok) throw new Error(response?.error || "Campaign could not be saved.");
    const index = campaigns.findIndex(item => item.id === response.campaign.id);
    if (index >= 0) campaigns[index] = response.campaign;
    else campaigns.push(response.campaign);
    selectedCampaignId = response.campaign.id;
    renderCampaignSelect();
    renderForm();
  }

  async function removeSearch(campaignId, url) {
    setBusy(true);
    try {
      const response = await chrome.runtime.sendMessage({type: "CODISTAN_REMOVE_SALES_NAV_SEARCH", campaign_id: campaignId, search_url: url});
      if (!response?.ok) throw new Error(response?.error || "Search could not be removed.");
      const index = campaigns.findIndex(item => item.id === campaignId);
      if (index >= 0) campaigns[index] = response.campaign;
      renderForm();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  elements.campaignSelect.addEventListener("change", () => {
    selectedCampaignId = elements.campaignSelect.value;
    renderForm();
  });

  elements.saveCampaign.addEventListener("click", async () => {
    setBusy(true);
    setStatus("Saving campaign definition…");
    try {
      await saveCampaign(campaignFromForm());
      setStatus("Campaign definition saved. Existing searches and history were preserved.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  });

  elements.newCampaign.addEventListener("click", () => {
    const id = normalizedId(elements.newCampaignId.value);
    if (!id) return setStatus("Enter a unique campaign ID before creating a campaign.");
    if (campaigns.some(campaign => campaign.id === id)) return setStatus("That campaign ID already exists.");
    selectedCampaignId = id;
    campaigns.push({
      id,
      name: id.replaceAll("_", " "),
      enabled: false,
      state: "on_hold",
      route: "research_only",
      offer_id: id,
      offer_type: "service",
      offer_name: id.replaceAll("_", " "),
      offer_summary: "",
      service_route: "delivery_partner",
      service_lanes: [],
      target_industry_terms: [],
      target_company_types: [],
      target_personas: [],
      target_seniority: [],
      target_geographies: [],
      positive_terms: [],
      first_touch_angle: "",
      no_buyer_intent_warning: "This is a cold research hypothesis. No explicit buying intent has been established.",
      search_urls: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
    elements.newCampaignId.value = "";
    renderCampaignSelect();
    renderForm();
    setStatus("New campaign created in on-hold state. Define and save it before registering searches.");
  });

  elements.duplicateCampaign.addEventListener("click", () => {
    const source = selectedCampaign();
    const id = normalizedId(elements.newCampaignId.value);
    if (!source || !id || campaigns.some(campaign => campaign.id === id)) return setStatus("Enter a new unique campaign ID before duplicating the selected campaign.");
    campaigns.push({...JSON.parse(JSON.stringify(source)), id, name: `${source.name} copy`, enabled: false, state: "on_hold", search_urls: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString()});
    selectedCampaignId = id;
    elements.newCampaignId.value = "";
    renderCampaignSelect();
    renderForm();
    setStatus("Campaign duplicated in on-hold state without copying registered searches.");
  });

  elements.registerSearch.addEventListener("click", async () => {
    const campaign = selectedCampaign();
    if (!campaign) return;
    setBusy(true);
    setStatus("Registering the Sales Navigator search under the selected campaign…");
    try {
      const response = await chrome.runtime.sendMessage({type: "CODISTAN_REGISTER_SALES_NAV_SEARCH", campaign_id: campaign.id, search_url: elements.searchUrl.value.trim()});
      if (!response?.ok) throw new Error(response?.error || "Search could not be registered.");
      const index = campaigns.findIndex(item => item.id === campaign.id);
      if (index >= 0) campaigns[index] = response.campaign;
      elements.searchUrl.value = "";
      renderForm();
      setStatus("Search registered. Run this campaign manually and review diagnostics before enabling routine scheduling.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  });

  elements.runNow.addEventListener("click", async () => {
    const campaign = selectedCampaign();
    if (!campaign) return;
    setBusy(true);
    setStatus(`Running ${campaign.name} in temporary inactive tabs…`);
    try {
      const response = await chrome.runtime.sendMessage({type: "CODISTAN_RUN_SALES_NAV_CAMPAIGNS_NOW", campaign_id: campaign.id});
      if (!response?.ok) throw new Error(response?.error || "Campaign run failed.");
      automationStatus = response;
      renderStatus();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  });

  elements.automationEnabled.addEventListener("change", async () => {
    elements.automationEnabled.disabled = true;
    try {
      const response = await chrome.runtime.sendMessage({type: "CODISTAN_SET_SALES_NAV_AUTOMATION", enabled: elements.automationEnabled.checked});
      if (!response?.ok) throw new Error(response?.error || "Automation setting could not be saved.");
      elements.automationEnabled.checked = response.enabled === true;
      renderStatus();
    } catch (error) {
      elements.automationEnabled.checked = !elements.automationEnabled.checked;
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      elements.automationEnabled.disabled = false;
    }
  });

  load().catch(error => setStatus(error instanceof Error ? error.message : String(error)));
})();
