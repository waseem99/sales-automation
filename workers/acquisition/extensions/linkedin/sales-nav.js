(() => {
  "use strict";

  const hardening = globalThis.CodistanLinkedInParserHardening;
  if (!hardening) return;

  const PARSER_VERSION = "sales-navigator-dom-1.1.0";
  const monitor = hardening.createDomMonitor(document);
  const LEAD_LINK_SELECTORS = [
    'a[href*="/sales/lead/"]',
    'a[href*="/in/"]'
  ];
  const CARD_SELECTORS = [
    '[data-x-search-result]',
    '[data-scroll-into-view]',
    'li.artdeco-list__item',
    '[role="listitem"]',
    'li',
    'article'
  ];
  const NAME_SELECTORS = [
    '[data-anonymize="person-name"]',
    '.artdeco-entity-lockup__title',
    '[class*="entity-lockup__title"]',
    '[data-test-id*="person-name"]'
  ];
  const HEADLINE_SELECTORS = [
    '[data-anonymize="headline"]',
    '.artdeco-entity-lockup__subtitle',
    '[class*="entity-lockup__subtitle"]',
    '[data-test-id*="headline"]'
  ];
  const COMPANY_SELECTORS = [
    '[data-anonymize="company-name"]',
    'a[href*="/sales/company/"]',
    'a[href*="/company/"]',
    '.artdeco-entity-lockup__caption',
    '[class*="entity-lockup__caption"]',
    '[data-test-id*="company-name"]'
  ];
  const LOCATION_SELECTORS = [
    '[data-anonymize="location"]',
    '.artdeco-entity-lockup__metadata',
    '[class*="entity-lockup__metadata"]',
    '[data-test-id*="location"]'
  ];

  function normalize(value, limit = 20000) {
    return hardening.normalizeText(value, limit);
  }

  function visible(element) {
    if (!(element instanceof Element)) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
  }

  function firstText(root, selectors) {
    for (const selector of selectors) {
      for (const node of root.querySelectorAll(selector)) {
        if (!visible(node)) continue;
        const value = normalize(node.innerText || node.textContent, 1000);
        if (value) return value;
      }
    }
    return "";
  }

  function canonicalLeadUrl(value) {
    return hardening.canonicalLeadUrl(value);
  }

  function nativeId(url) {
    const sales = /\/sales\/lead\/([^/?#]+)/i.exec(url);
    if (sales) return decodeURIComponent(sales[1]);
    const profile = /\/in\/([^/?#]+)/i.exec(url);
    return profile ? `linkedin-in:${decodeURIComponent(profile[1])}` : url;
  }

  function cardForAnchor(anchor) {
    for (const selector of CARD_SELECTORS) {
      const candidate = anchor.closest(selector);
      if (!candidate || !visible(candidate)) continue;
      const text = normalize(candidate.innerText || candidate.textContent);
      if (text.length >= 25 && text.length <= 12000) return candidate;
    }
    let node = anchor.parentElement;
    for (let depth = 0; node && depth < 8; depth += 1, node = node.parentElement) {
      const text = normalize(node.innerText || node.textContent);
      if (visible(node) && text.length >= 35 && text.length <= 5000) return node;
    }
    return anchor.parentElement || anchor;
  }

  function relationshipFrom(text) {
    const match = /\b(?:1st|2nd|3rd)(?:\+)?\b/i.exec(text);
    return match?.[0] || "";
  }

  function mutualConnectionsFrom(text) {
    const match = /\b(\d+)\s+(?:mutual|shared)\s+connections?\b/i.exec(text);
    return match ? Number(match[1]) : 0;
  }

  function visibleLeadAnchors() {
    const anchors = [];
    const seen = new Set();
    for (const selector of LEAD_LINK_SELECTORS) {
      for (const anchor of document.querySelectorAll(selector)) {
        if (!(anchor instanceof HTMLAnchorElement) || !visible(anchor)) continue;
        const url = canonicalLeadUrl(anchor.href || anchor.getAttribute("href"));
        if (!url || seen.has(url)) continue;
        seen.add(url);
        anchors.push({anchor, url});
      }
    }
    return anchors;
  }

  function increment(map, key) {
    map[key] = Number(map[key] || 0) + 1;
  }

  function extractVisibleProspects(limit = 30) {
    const records = [];
    const seen = new Set();
    const anchors = visibleLeadAnchors();
    const diagnostics = {
      parser_version: PARSER_VERSION,
      hardening_version: hardening.VERSION,
      visible_lead_links: anchors.length,
      readable_cards: 0,
      captured_prospects: 0,
      missing_name: 0,
      missing_headline: 0,
      missing_company: 0,
      partial_parse_rejections: 0,
      duplicate_profiles: 0,
      rejection_reasons: {},
      layout_signature: hardening.layoutSignature(document, {cards: CARD_SELECTORS, names: NAME_SELECTORS, headlines: HEADLINE_SELECTORS, companies: COMPANY_SELECTORS}),
      dom_mutations: monitor.snapshot()
    };

    for (const {anchor, url} of anchors) {
      if (seen.has(url)) {
        diagnostics.duplicate_profiles += 1;
        continue;
      }
      const card = cardForAnchor(anchor);
      const cardText = normalize(card.innerText || card.textContent, 12000);
      if (cardText.length < 25) {
        increment(diagnostics.rejection_reasons, "missing_readable_card");
        continue;
      }
      diagnostics.readable_cards += 1;

      const name = firstText(card, NAME_SELECTORS) || normalize(anchor.innerText || anchor.textContent, 300);
      const headline = firstText(card, HEADLINE_SELECTORS);
      const company = firstText(card, COMPANY_SELECTORS);
      const locationText = firstText(card, LOCATION_SELECTORS);
      if (!name) diagnostics.missing_name += 1;
      if (!headline) diagnostics.missing_headline += 1;
      if (!company) diagnostics.missing_company += 1;

      const relationship = relationshipFrom(cardText);
      const mutualConnections = mutualConnectionsFrom(cardText);
      const postedOnLinkedIn = /\bposted on linkedin\b|\brecent(?:ly)? posted\b/i.test(cardText);
      const changedJobs = /\bchanged jobs?\b|\bnew role\b|\bstarted a new position\b/i.test(cardText);
      const teamlink = /\bteamlink\b|\bteam link\b/i.test(cardText);
      const recentActivity = /\bactive on linkedin\b|\brecent activity\b|\bposted on linkedin\b/i.test(cardText);
      const title = `${name}${headline ? ` — ${headline}` : company ? ` — ${company}` : ""}`.slice(0, 500);
      const body = [
        `Prospect: ${name}`,
        headline ? `Role: ${headline}` : "",
        company ? `Company: ${company}` : "",
        locationText ? `Location: ${locationText}` : "",
        relationship ? `Relationship: ${relationship}` : "",
        `Visible Sales Navigator card: ${cardText}`
      ].filter(Boolean).join(" | ").slice(0, 20000);

      const record = {
        source_url: url,
        source_native_id: nativeId(url),
        title,
        body,
        author: {
          name: name.slice(0, 300),
          profile_url: url,
          headline: headline.slice(0, 500),
          company: company.slice(0, 300)
        },
        commercial_evidence: {
          service_lanes: []
        },
        raw_evidence: {
          location: locationText.slice(0, 300),
          relationship,
          mutual_connections: mutualConnections,
          posted_on_linkedin: postedOnLinkedIn,
          changed_jobs: changedJobs,
          teamlink,
          recent_activity: recentActivity,
          visible_card_text: cardText,
          source_classification: "cold_no_confirmed_intent",
          buyer_intent_confirmed: false,
          extraction_version: PARSER_VERSION,
          parser_hardening_version: hardening.VERSION,
          parser_status: "pending"
        }
      };
      const assessment = hardening.evaluateSalesNavigatorRecord(record);
      record.raw_evidence.parser_status = assessment.status;
      record.raw_evidence.parser_diagnostics = assessment;
      if (assessment.status !== "complete") {
        diagnostics.partial_parse_rejections += 1;
        for (const field of assessment.missing_critical_fields) increment(diagnostics.rejection_reasons, `missing_${field}`);
        continue;
      }

      seen.add(url);
      records.push(record);
      if (records.length >= limit) break;
    }

    const deduped = hardening.dedupeRecords(records);
    diagnostics.duplicate_profiles += deduped.duplicates;
    diagnostics.captured_prospects = deduped.records.length;
    diagnostics.dom_mutations = monitor.snapshot();
    return {records: deduped.records, diagnostics: hardening.sanitize(diagnostics)};
  }

  function candidateScrollers() {
    const candidates = [];
    const add = element => {
      if (!element || candidates.includes(element)) return;
      const height = Number(element.scrollHeight || 0);
      const client = Number(element.clientHeight || 0);
      if (height > client + 80) candidates.push(element);
    };
    add(document.scrollingElement);
    add(document.documentElement);
    add(document.body);
    for (const {anchor} of visibleLeadAnchors().slice(0, 5)) {
      let node = anchor.parentElement;
      for (let depth = 0; node && depth < 12; depth += 1, node = node.parentElement) add(node);
    }
    for (const node of document.querySelectorAll('main, [role="main"], [class*="search-results"], [class*="results-list"]')) add(node);
    return candidates.sort((left, right) => (right.scrollHeight - right.clientHeight) - (left.scrollHeight - left.clientHeight));
  }

  function scrollerDescriptor(scroller) {
    if (!scroller) return "none";
    if (scroller === document.scrollingElement || scroller === document.documentElement || scroller === document.body) return "document";
    const id = scroller.id ? `#${scroller.id}` : "";
    const cls = typeof scroller.className === "string" ? `.${scroller.className.trim().split(/\s+/).slice(0, 2).join(".")}` : "";
    return `${scroller.tagName.toLowerCase()}${id}${cls}`.slice(0, 180);
  }

  function scrollTopOf(scroller) {
    return scroller === document.scrollingElement || scroller === document.documentElement || scroller === document.body
      ? window.scrollY
      : Number(scroller.scrollTop || 0);
  }

  function setScrollTop(scroller, top) {
    if (scroller === document.scrollingElement || scroller === document.documentElement || scroller === document.body) window.scrollTo({top, behavior: "auto"});
    else scroller.scrollTo({top, behavior: "auto"});
  }

  async function scrollResults(waitMs = 3000) {
    const scrollers = candidateScrollers();
    for (const scroller of scrollers) {
      const before = scrollTopOf(scroller);
      const beforeHeight = Number(scroller.scrollHeight || document.documentElement.scrollHeight || 0);
      const clientHeight = Number(scroller.clientHeight || window.innerHeight || 800);
      const target = Math.min(before + Math.max(650, Math.round(clientHeight * 0.82)), Math.max(0, beforeHeight - clientHeight));
      if (target <= before + 20) continue;
      setScrollTop(scroller, target);
      await new Promise(resolve => setTimeout(resolve, Math.max(500, Number(waitMs) || 3000)));
      const after = scrollTopOf(scroller);
      const afterHeight = Number(scroller.scrollHeight || document.documentElement.scrollHeight || 0);
      if (after > before + 10 || afterHeight > beforeHeight + 20) {
        return {
          ok: true,
          moved: true,
          top: after,
          before_height: beforeHeight,
          after_height: afterHeight,
          at_end: after + clientHeight >= afterHeight - 40,
          scroller: scrollerDescriptor(scroller),
          parser_diagnostics: hardening.sanitize({parser_version: PARSER_VERSION, dom_mutations: monitor.snapshot()})
        };
      }
    }
    return {
      ok: true,
      moved: false,
      at_end: true,
      reason: "no_movable_scroll_container",
      scroller: scrollerDescriptor(scrollers[0]),
      parser_diagnostics: hardening.sanitize({parser_version: PARSER_VERSION, dom_mutations: monitor.snapshot()})
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message) return false;
    try {
      if (message.type === "CODISTAN_CAPTURE_VISIBLE_SALES_NAVIGATOR_LEADS") {
        const extracted = extractVisibleProspects(Number(message.limit) || 30);
        sendResponse({ok: true, page_url: location.href, page_title: document.title, ...extracted});
        return true;
      }
      if (message.type === "CODISTAN_SALES_NAV_SCROLL_STATUS") {
        const scroller = candidateScrollers()[0] || document.scrollingElement;
        sendResponse({ok: true, top: scrollTopOf(scroller), scroller: scrollerDescriptor(scroller), parser_version: PARSER_VERSION});
        return true;
      }
      if (message.type === "CODISTAN_SCROLL_SALES_NAV_RESULTS") {
        scrollResults(message.wait_ms).then(sendResponse).catch(error => sendResponse({ok: false, error: hardening.safeError(error), parser_version: PARSER_VERSION}));
        return true;
      }
      if (message.type === "CODISTAN_RESTORE_SALES_NAV_SCROLL") {
        const scroller = candidateScrollers()[0] || document.scrollingElement;
        setScrollTop(scroller, Number(message.top || 0));
        sendResponse({ok: true, parser_version: PARSER_VERSION});
        return true;
      }
    } catch (error) {
      sendResponse({ok: false, error: hardening.safeError(error), parser_version: PARSER_VERSION});
      return true;
    }
    return false;
  });
})();
