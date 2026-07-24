(() => {
  "use strict";

  const CAMPAIGN_ID = "fintech_backend_operations";
  const nodes = {
    campaignEnabled: document.getElementById("campaignEnabled"),
    campaignName: document.getElementById("campaignName"),
    offerName: document.getElementById("offerName"),
    offerSummary: document.getElementById("offerSummary"),
    serviceRoute: document.getElementById("serviceRoute"),
    serviceLanes: document.getElementById("serviceLanes"),
    industries: document.getElementById("industries"),
    personas: document.getElementById("personas"),
    geographies: document.getElementById("geographies"),
    searchUrl: document.getElementById("searchUrl"),
    searchList: document.getElementById("searchList"),
    automationEnabled: document.getElementById("automationEnabled"),
    status: document.getElementById("status"),
    saveCampaign: document.getElementById("saveCampaign"),
    registerSearch: document.getElementById("registerSearch"),
    runNow: document.getElementById("runNow")
  };
  let campaign = null;

  function list(value) {
    return Array.isArray(value) ? value : [];
  }

  function lines(value) {
    return list(value).join("\n");
  }

  function split(value) {
    return [...new Set(String(value || "").split(/[\n,]/).map(item => item.trim()).filter(Boolean))];
  }

  function setBusy(busy) {
    nodes.saveCampaign.disabled = busy;
    nodes.registerSearch.disabled = busy;
    nodes.runNow.disabled = busy;
    nodes.automationEnabled.disabled = busy;
  }

  function setStatus(value) {
    nodes.status.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  }

  function renderCampaign(value) {
    campaign = value;
    nodes.campaignEnabled.checked = value.enabled !== false;
    nodes.campaignName.value = value.name || "";
    nodes.offerName.value = value.offer_name || "";
    nodes.offerSummary.value = value.offer_summary || "";
    nodes.serviceRoute.value = value.service_route || "software_product";
    nodes.serviceLanes.value = list(value.service_lanes).join(", ");
    nodes.industries.value = lines(value.target_industry_terms);
    nodes.personas.value = lines(value.target_personas);
    nodes.geographies.value = lines(value.target_geographies);
    renderSearches(value.search_urls || []);
  }

  function renderSearches(urls) {
    nodes.searchList.textContent = "";
    if (!urls.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "No approved Sales Navigator lead searches are registered yet.";
      nodes.searchList.appendChild(empty);
      return;
    }
    for (const url of urls) {
      const item = document.createElement("div");
      item.className = "search-item";
      const link = document.createElement("a");
      link.href = url;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = url;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "Remove";
      remove.addEventListener("click", () => removeSearch(url));
      item.append(link, remove);
      nodes.searchList.appendChild(item);
    }
  }

  function formCampaign() {
    return {
      ...campaign,
      id: campaign?.id || CAMPAIGN_ID,
      enabled: nodes.campaignEnabled.checked,
      name: nodes.campaignName.value,
      offer_type: campaign?.offer_type || "hybrid",
      offer_name: nodes.offerName.value,
      offer_summary: nodes.offerSummary.value,
      service_route: nodes.serviceRoute.value,
      service_lanes: split(nodes.serviceLanes.value),
      target_industry_terms: split(nodes.industries.value),
      target_personas: split(nodes.personas.value),
      target_geographies: split(nodes.geographies.value),
      search_urls: campaign?.search_urls || []
    };
  }

  function diagnosticLine(search, index) {
    const diagnostics = search?.diagnostics || {};
    const label = `Search ${index + 1}`;
    if (search?.ok === false) return `${label}: ERROR — ${search.error || "unknown Sales Navigator error"}`;
    const visible = Number(diagnostics.visible_lead_links || 0);
    const readable = Number(diagnostics.readable_cards || 0);
    const captured = Number(diagnostics.captured_prospects || search?.record_count || 0);
    const missingName = Number(diagnostics.missing_name || 0);
    const missingRole = Number(diagnostics.missing_headline || 0);
    const missingCompany = Number(diagnostics.missing_company || 0);
    return `${label}: ${captured} captured from ${visible} visible lead links and ${readable} readable cards; scroll steps ${Number(search?.scroll_steps || 0)}; stop ${search?.stop_reason || "unknown"}; missing name ${missingName}, role ${missingRole}, company ${missingCompany}.`;
  }

  function summary(response) {
    const status = response.status;
    const state = response.enabled ? `Scheduled every ${response.interval_minutes} minutes.` : "Scheduled capture disabled.";
    if (!status) return `${state}\nNo Sales Navigator campaign cycle has completed yet.`;
    const campaigns = Array.isArray(status.campaigns) ? status.campaigns : [];
    const searches = campaigns.flatMap(item => Array.isArray(item.searches) ? item.searches : []);
    if (status.running) return `${state}\nRunning now: ${campaigns.length} campaigns, ${searches.length} searches completed, ${status.accepted || 0} new prospects so far.`;
    const details = searches.slice(0, 8).map(diagnosticLine);
    if (searches.length > 8) details.push(`${searches.length - 8} additional search results are stored in the extension status.`);
    return [
      state,
      `Last completed: ${status.completed_at || "unknown"}`,
      `Campaigns: ${campaigns.length}; searches: ${searches.length}`,
      `New: ${status.accepted || 0}; duplicate: ${status.duplicates || 0}; enriched: ${status.enriched || 0}; rejected: ${status.rejected || 0}`,
      status.last_error ? `Issue: ${status.last_error}` : "",
      ...details
    ].filter(Boolean).join("\n");
  }

  async function load() {
    const response = await chrome.runtime.sendMessage({type: "CODISTAN_GET_SALES_NAV_CAMPAIGNS"});
    if (!response?.ok) throw new Error(response?.error || "Campaign settings are unavailable.");
    const selected = response.campaigns.find(item => item.id === CAMPAIGN_ID) || response.campaigns[0];
    if (!selected) throw new Error("No Sales Navigator campaign is configured.");
    const firstUse = !response.status && list(selected.search_urls).length === 0;
    if (firstUse && response.enabled === true) {
      const disabled = await chrome.runtime.sendMessage({type: "CODISTAN_SET_SALES_NAV_AUTOMATION", enabled: false});
      if (!disabled?.ok) throw new Error(disabled?.error || "Scheduled capture could not be disabled for the manual pilot.");
      response.enabled = false;
    }
    renderCampaign(selected);
    nodes.automationEnabled.checked = response.enabled === true;
    const firstUseNotice = firstUse
      ? "Manual pilot required: scheduled Sales Navigator capture is off until the first search is registered, run and commercially reviewed.\n"
      : "";
    setStatus(`${firstUseNotice}${summary(response)}`);
  }

  async function removeSearch(url) {
    setBusy(true);
    try {
      const response = await chrome.runtime.sendMessage({type: "CODISTAN_REMOVE_SALES_NAV_SEARCH", campaign_id: campaign.id, search_url: url});
      if (!response?.ok) throw new Error(response?.error || "The search could not be removed.");
      renderCampaign(response.campaign);
      setStatus("Approved search removed. Existing captured prospects and campaign history were preserved.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  nodes.saveCampaign.addEventListener("click", async () => {
    setBusy(true);
    try {
      const response = await chrome.runtime.sendMessage({type: "CODISTAN_SAVE_SALES_NAV_CAMPAIGN", campaign: formCampaign()});
      if (!response?.ok) throw new Error(response?.error || "Campaign could not be saved.");
      renderCampaign(response.campaign);
      setStatus("Campaign definition saved. Future captures will use the updated offer and ICP.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  });

  nodes.registerSearch.addEventListener("click", async () => {
    setBusy(true);
    setStatus("Registering the Sales Navigator search…");
    try {
      const response = await chrome.runtime.sendMessage({type: "CODISTAN_REGISTER_SALES_NAV_SEARCH", campaign_id: campaign.id, search_url: nodes.searchUrl.value.trim()});
      if (!response?.ok) throw new Error(response?.error || "Search registration failed.");
      nodes.searchUrl.value = "";
      renderCampaign(response.campaign);
      setStatus(`Registered approved search:\n${response.url}\nRun it manually before enabling scheduled capture.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  });

  nodes.automationEnabled.addEventListener("change", async () => {
    setBusy(true);
    try {
      const response = await chrome.runtime.sendMessage({type: "CODISTAN_SET_SALES_NAV_AUTOMATION", enabled: nodes.automationEnabled.checked});
      if (!response?.ok) throw new Error(response?.error || "Automation setting could not be changed.");
      await load();
    } catch (error) {
      nodes.automationEnabled.checked = !nodes.automationEnabled.checked;
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  });

  nodes.runNow.addEventListener("click", async () => {
    setBusy(true);
    setStatus("Running the registered FinTech Sales Navigator searches now. Temporary tabs stay inactive and close automatically…");
    try {
      const response = await chrome.runtime.sendMessage({type: "CODISTAN_RUN_SALES_NAV_CAMPAIGNS_NOW", campaign_id: campaign.id});
      if (!response?.ok) throw new Error(response?.error || "Campaign run failed.");
      await load();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  });

  load().catch(error => setStatus(error instanceof Error ? error.message : String(error)));
})();
