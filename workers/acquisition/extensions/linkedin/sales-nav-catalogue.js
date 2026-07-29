(() => {
  "use strict";

  const STORAGE_KEY = "codistan_sales_nav_campaigns";
  const CATALOGUE_VERSION_KEY = "codistan_sales_nav_catalogue_version";
  const CATALOGUE_VERSION = "offer-campaign-catalogue-v1";
  const now = () => new Date().toISOString();

  const seeds = [
    {
      id: "fintech_direct_buyers",
      legacy_id: "fintech_backend_operations",
      name: "FinTech Platform — Direct Buyers",
      enabled: true,
      state: "active",
      route: "direct_buyer",
      offer_id: "fintech_operations_platform",
      offer_type: "hybrid",
      offer_name: "FinTech Backend Operations Platform",
      offer_summary: "A modular backend operations, workflow automation, integration and AI-assisted operations platform with managed implementation for fintech and financial-services teams.",
      service_route: "software_product",
      service_lanes: ["software_product", "ai_automation", "managed_implementation"],
      target_industry_terms: ["fintech", "payments", "digital banking", "wallet", "lending", "NBFC", "microfinance", "remittance", "cross-border payments", "financial infrastructure", "regtech"],
      target_company_types: ["fintech", "payments company", "bank", "wallet", "lender", "NBFC", "remittance platform", "financial infrastructure"],
      target_personas: ["Founder", "Co-Founder", "CEO", "COO", "CTO", "CIO", "CPO", "VP Engineering", "VP Product", "Head of Operations", "Head of Product", "Head of Technology", "Head of Platform", "Head of Integrations", "Head of Digital Transformation"],
      target_seniority: ["Owner", "CXO", "VP", "Director", "Head"],
      target_geographies: [],
      positive_terms: ["operations", "workflow", "automation", "integration", "platform", "scaling", "digital transformation", "AI", "reconciliation", "onboarding"],
      first_touch_angle: "Explore whether a modular backend-operations and managed implementation layer can reduce fragmentation or accelerate the account's current product and operations roadmap.",
      no_buyer_intent_warning: "This is a cold ICP match. No explicit buying intent has been established.",
      search_urls: [],
      created_at: now(),
      updated_at: now()
    },
    {
      id: "fintech_channel_partners",
      name: "FinTech Platform — Channel and Implementation Partners",
      enabled: true,
      state: "active",
      route: "channel_partner",
      offer_id: "fintech_operations_platform",
      offer_type: "hybrid",
      offer_name: "FinTech Backend Operations Platform",
      offer_summary: "Channel, implementation and white-label partnership for consultancies, system integrators and agencies serving financial-services clients.",
      service_route: "delivery_partner",
      service_lanes: ["software_product", "delivery_partner", "managed_implementation"],
      target_industry_terms: ["consultancy", "system integrator", "software agency", "fintech consultancy", "implementation partner", "financial services practice"],
      target_company_types: ["consultancy", "system integrator", "software agency", "implementation partner"],
      target_personas: ["Founder", "Managing Director", "Practice Head", "Head of Partnerships", "Strategic Partnerships", "Solutions Director", "Delivery Director", "FinTech Practice Lead"],
      target_seniority: ["Owner", "CXO", "VP", "Director", "Head"],
      target_geographies: [],
      positive_terms: ["client delivery", "implementation", "advisory", "integration", "financial services practice", "partner ecosystem", "white label"],
      first_touch_angle: "Explore a channel, implementation or white-label relationship for delivering a backend-operations and AI-native financial-services solution to the partner's clients.",
      no_buyer_intent_warning: "This is a cold partner hypothesis. No explicit partnership or buyer intent has been established.",
      search_urls: [],
      created_at: now(),
      updated_at: now()
    },
    {
      id: "software_ai_overflow_partners",
      name: "Software and AI Agencies — Overflow Delivery Partners",
      enabled: true,
      state: "active",
      route: "delivery_partner",
      offer_id: "managed_software_ai_delivery",
      offer_type: "service",
      offer_name: "Managed Software and AI Delivery Partnership",
      offer_summary: "Accountable white-label and overflow software, AI, product, QA, DevOps, cybersecurity and implementation capacity for agencies, consultancies and product companies.",
      service_route: "delivery_partner",
      service_lanes: ["delivery_partner", "software_product", "ai_automation", "cybersecurity"],
      target_industry_terms: ["software agency", "AI agency", "digital agency", "consultancy", "system integrator", "SaaS", "product company", "technology services"],
      target_company_types: ["software agency", "AI agency", "digital agency", "consultancy", "system integrator", "SaaS company"],
      target_personas: ["Founder", "Agency Owner", "CEO", "CTO", "COO", "Head of Delivery", "Delivery Director", "Engineering Director", "Practice Lead", "Head of Partnerships"],
      target_seniority: ["Owner", "CXO", "VP", "Director", "Head"],
      target_geographies: [],
      positive_terms: ["client work", "delivery", "overflow", "white label", "implementation", "engineering capacity", "AI projects", "managed team", "subcontracting"],
      first_touch_angle: "Explore whether Codistan can become an accountable backend delivery team for overflow software, AI or implementation work while the partner retains its client relationship.",
      no_buyer_intent_warning: "This is a cold delivery-partner hypothesis. No explicit overflow need has been confirmed.",
      search_urls: [],
      created_at: now(),
      updated_at: now()
    }
  ];

  function list(value) {
    return Array.isArray(value) ? value : [];
  }

  function mergeCampaign(existing, seed) {
    return {
      ...seed,
      ...existing,
      id: seed.id,
      name: existing?.name || seed.name,
      offer_id: existing?.offer_id || seed.offer_id,
      route: existing?.route || seed.route,
      search_urls: list(existing?.search_urls),
      created_at: existing?.created_at || seed.created_at,
      updated_at: now()
    };
  }

  async function ensureCatalogue() {
    const stored = await chrome.storage.local.get([STORAGE_KEY, CATALOGUE_VERSION_KEY]);
    const current = list(stored[STORAGE_KEY]);
    if (stored[CATALOGUE_VERSION_KEY] === CATALOGUE_VERSION && seeds.every(seed => current.some(item => item.id === seed.id))) return;

    const legacy = current.find(item => item.id === "fintech_backend_operations");
    const next = current.filter(item => item.id !== "fintech_backend_operations");
    for (const seed of seeds) {
      const existing = next.find(item => item.id === seed.id);
      const migrated = seed.id === "fintech_direct_buyers" && legacy
        ? {
            ...legacy,
            id: seed.id,
            legacy_id: legacy.id,
            search_urls: list(legacy.search_urls),
            enabled: legacy.enabled !== false,
            state: legacy.enabled === false ? "on_hold" : "active"
          }
        : existing;
      const normalized = mergeCampaign(migrated, seed);
      const index = next.findIndex(item => item.id === seed.id);
      if (index >= 0) next[index] = normalized;
      else next.push(normalized);
    }
    if (legacy) {
      next.push({
        ...legacy,
        id: "fintech_backend_operations_legacy",
        enabled: false,
        state: "on_hold",
        superseded_by: "fintech_direct_buyers",
        search_urls: [],
        updated_at: now()
      });
    }
    await chrome.storage.local.set({
      [STORAGE_KEY]: next,
      [CATALOGUE_VERSION_KEY]: CATALOGUE_VERSION
    });
  }

  chrome.runtime.onInstalled.addListener(() => ensureCatalogue().catch(() => {}));
  chrome.runtime.onStartup.addListener(() => ensureCatalogue().catch(() => {}));
  ensureCatalogue().catch(() => {});
})();
