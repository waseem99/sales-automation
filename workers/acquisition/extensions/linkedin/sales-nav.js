(() => {
  "use strict";

  const LEAD_LINK_SELECTORS = [
    'a[href*="/sales/lead/"]',
    'a[href*="/in/"]'
  ];
  const CARD_SELECTORS = [
    '[data-x-search-result]',
    '[data-scroll-into-view]',
    'li.artdeco-list__item',
    'li',
    'article'
  ];
  const NAME_SELECTORS = [
    '[data-anonymize="person-name"]',
    '.artdeco-entity-lockup__title',
    '[class*="entity-lockup__title"]'
  ];
  const HEADLINE_SELECTORS = [
    '[data-anonymize="headline"]',
    '.artdeco-entity-lockup__subtitle',
    '[class*="entity-lockup__subtitle"]'
  ];
  const COMPANY_SELECTORS = [
    '[data-anonymize="company-name"]',
    'a[href*="/sales/company/"]',
    'a[href*="/company/"]',
    '.artdeco-entity-lockup__caption',
    '[class*="entity-lockup__caption"]'
  ];
  const LOCATION_SELECTORS = [
    '[data-anonymize="location"]',
    '.artdeco-entity-lockup__metadata',
    '[class*="entity-lockup__metadata"]'
  ];

  function normalize(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
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
        const value = normalize(node.innerText || node.textContent);
        if (value) return value;
      }
    }
    return "";
  }

  function canonicalLeadUrl(value) {
    try {
      const url = new URL(value, location.href);
      if (!["linkedin.com", "www.linkedin.com", "sales.linkedin.com"].includes(url.hostname)) return "";
      if (!url.pathname.startsWith("/sales/lead/") && !url.pathname.startsWith("/in/")) return "";
      url.protocol = "https:";
      url.hostname = "www.linkedin.com";
      url.search = "";
      url.hash = "";
      return url.toString().replace(/\/$/, "");
    } catch (_error) {
      return "";
    }
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

  function extractVisibleProspects(limit = 30) {
    const records = [];
    const seen = new Set();
    const anchors = visibleLeadAnchors();
    const diagnostics = {
      visible_lead_links: anchors.length,
      readable_cards: 0,
      captured_prospects: 0,
      missing_name: 0,
      missing_headline: 0,
      missing_company: 0,
      duplicate_profiles: 0
    };

    for (const {anchor, url} of anchors) {
      if (seen.has(url)) {
        diagnostics.duplicate_profiles += 1;
        continue;
      }
      const card = cardForAnchor(anchor);
      const cardText = normalize(card.innerText || card.textContent).slice(0, 12000);
      if (cardText.length < 25) continue;
      diagnostics.readable_cards += 1;

      const name = firstText(card, NAME_SELECTORS) || normalize(anchor.innerText || anchor.textContent);
      const headline = firstText(card, HEADLINE_SELECTORS);
      const company = firstText(card, COMPANY_SELECTORS);
      const locationText = firstText(card, LOCATION_SELECTORS);
      if (!name) diagnostics.missing_name += 1;
      if (!headline) diagnostics.missing_headline += 1;
      if (!company) diagnostics.missing_company += 1;
      if (!name || (!headline && !company)) continue;

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

      seen.add(url);
      records.push({
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
          extraction_version: "sales-navigator-dom-1.0.0"
        }
      });
      if (records.length >= limit) break;
    }
    diagnostics.captured_prospects = records.length;
    return {records, diagnostics};
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
          scroller: scrollerDescriptor(scroller)
        };
      }
    }
    return {ok: true, moved: false, at_end: true, reason: "no_movable_scroll_container", scroller: scrollerDescriptor(scrollers[0])};
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
        sendResponse({ok: true, top: scrollTopOf(scroller), scroller: scrollerDescriptor(scroller)});
        return true;
      }
      if (message.type === "CODISTAN_SCROLL_SALES_NAV_RESULTS") {
        scrollResults(message.wait_ms).then(sendResponse).catch(error => sendResponse({ok: false, error: error instanceof Error ? error.message : String(error)}));
        return true;
      }
      if (message.type === "CODISTAN_RESTORE_SALES_NAV_SCROLL") {
        const scroller = candidateScrollers()[0] || document.scrollingElement;
        setScrollTop(scroller, Number(message.top || 0));
        sendResponse({ok: true});
        return true;
      }
    } catch (error) {
      sendResponse({ok: false, error: error instanceof Error ? error.message : String(error)});
      return true;
    }
    return false;
  });
})();
