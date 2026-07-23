(() => {
  "use strict";

  const SERVICE_PATTERNS = {
    software: /\b(?:software|web(?:site)?|mobile|app|saas|mvp|platform|portal|e-?commerce|marketplace|react|node(?:\.js)?|python|development team|developers?)\b/i,
    ai_automation: /\b(?:ai|artificial intelligence|automation|agentic|agents?|rag|llm|chatbot|copilot|voice ai|machine learning|document intelligence)\b/i,
    cybersecurity: /\b(?:cybersecurity|cyber security|vapt|penetration test|security assessment|cloud security|iam|iso 27001|soc 2|hipaa|cmmc|compliance consultant)\b/i,
    digital_growth: /\b(?:digital marketing|social media|content (?:strategy|marketing|creation)|performance marketing|paid ads?|meta ads?|google ads?|seo|gmb|branding|growth marketing)\b/i,
    creative_animation: /\b(?:video production|video editing|animation|motion design|motion graphics|2d|3d|product visualization|creative studio|ai creative)\b/i,
    immersive_game: /\b(?:game development|unity|unreal|ar\/?vr|augmented reality|virtual reality|immersive|interactive experience)\b/i,
    delivery_partner: /\b(?:white[- ]label|subcontract|outsourc(?:e|ing)|overflow|delivery partner|implementation partner|development partner|agency partner)\b/i
  };

  const INTENT_PATTERNS = [
    /\blooking for\b/i,
    /\bseeking\b/i,
    /\bneed(?:ing)?\b/i,
    /\brequir(?:e|ed|ing|ement)\b/i,
    /\bcan anyone recommend\b/i,
    /\brecommendations? for\b/i,
    /\brequest for proposal\b/i,
    /\brfp\b/i,
    /\bexpression of interest\b/i,
    /\beoi\b/i,
    /\binviting (?:agencies|vendors|consultants|partners|proposals)\b/i,
    /\bsubmit (?:a )?(?:proposal|quotation|quote|portfolio)\b/i,
    /\bvendor (?:needed|required|selection|search)\b/i,
    /\bagency (?:needed|required|search)\b/i,
    /\bpartner with\b/i,
    /\bcalling (?:all )?(?:agencies|vendors|consultants|freelancers|partners|service providers)\b/i,
    /\b(?:expanding|building) (?:our|a) network of\b/i,
    /\b(?:freelance|project[- ]based) engagements?\b/i
  ];

  const SELF_PROMOTION = /\b(?:open to work|available for freelance|available for work|looking for opportunities|seeking (?:a )?(?:job|role|position)|my portfolio|hire me|actively looking for a new role)\b/i;
  const VACANCY = /\b(?:we(?:'re| are) hiring|job opening|vacancy|join our team|apply now|send (?:your )?(?:cv|resume)|full[- ]time role|part[- ]time role|position available|salary range)\b/i;
  const AGENCY_ENTITY = /\b(?:agency|vendor|consultant|consultancy|partner|firm|studio|company|team|service provider)\b/i;
  const CONTACT_PATTERNS = {
    email: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
    direct_message: /\b(?:dm|direct message|inbox|message me|reach out)\b/i,
    comment: /\b(?:comment below|drop a comment|tag someone)\b/i,
    proposal: /\b(?:proposal|quotation|quote|portfolio|rfp|eoi)\b/i
  };

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function activityUrnFromValue(value) {
    const match = /(urn:li:activity:\d{8,})/i.exec(String(value || ""));
    return match ? match[1].toLowerCase() : "";
  }

  function canonicalPostUrl(href, fallbackUrn = "") {
    try {
      const url = new URL(href || "", "https://www.linkedin.com");
      if (!["linkedin.com", "www.linkedin.com"].includes(url.hostname)) throw new Error("wrong host");
      if (url.pathname.startsWith("/posts/") || url.pathname.startsWith("/feed/update/") || url.pathname.startsWith("/pulse/")) {
        return `https://www.linkedin.com${url.pathname.replace(/\/$/, "")}`;
      }
    } catch (_error) {
      // Fall through to activity URN.
    }
    const urn = activityUrnFromValue(fallbackUrn || href);
    return urn ? `https://www.linkedin.com/feed/update/${urn}` : "";
  }

  function classifyOpportunity(value) {
    const text = normalizeText(value);
    const serviceLanes = Object.entries(SERVICE_PATTERNS)
      .filter(([, pattern]) => pattern.test(text))
      .map(([lane]) => lane);
    const intentPhrases = INTENT_PATTERNS
      .map(pattern => pattern.exec(text)?.[0] || "")
      .filter(Boolean)
      .map(normalizeText);

    let rejectReason = "";
    if (SELF_PROMOTION.test(text)) rejectReason = "job_seeker_or_self_promotion";
    else if (VACANCY.test(text) && !AGENCY_ENTITY.test(text)) rejectReason = "permanent_vacancy";
    else if (!intentPhrases.length) rejectReason = "no_explicit_buyer_intent";
    else if (!serviceLanes.length) rejectReason = "no_supported_service_lane";

    const contactRoutes = Object.entries(CONTACT_PATTERNS)
      .filter(([, pattern]) => pattern.test(text))
      .map(([route]) => route);
    const procurement = /\b(?:request for proposal|rfp|expression of interest|eoi|tender|procurement)\b/i.test(text);

    return {
      candidate: !rejectReason,
      reject_reason: rejectReason,
      signal_type: procurement ? "procurement_request" : "direct_service_requirement",
      service_lanes: serviceLanes,
      intent_phrases: [...new Set(intentPhrases.map(item => item.toLowerCase()))],
      contact_routes: contactRoutes
    };
  }

  globalThis.CodistanLinkedInSignal = Object.freeze({
    activityUrnFromValue,
    canonicalPostUrl,
    classifyOpportunity,
    normalizeText
  });
})();