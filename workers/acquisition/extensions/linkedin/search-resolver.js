(() => {
  "use strict";

  const CARD_SELECTOR = '[data-codistan-opportunity-card="true"]';
  const AGE_TEXT = /^(?:\d+\s*(?:m|h|d|w|mo|yr)s?|just now)(?:\s*•.*)?$/i;
  const DEFAULT_WAIT_MS = 2500;
  const MIN_WAIT_MS = 1800;
  const MAX_WAIT_MS = 4000;

  function normalize(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function decodedVariants(value) {
    const variants = new Set([String(value || "")]);
    let current = String(value || "");
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const decoded = decodeURIComponent(current);
        if (!decoded || decoded === current) break;
        variants.add(decoded);
        current = decoded;
      } catch (_error) {
        break;
      }
    }
    return [...variants];
  }

  function canonicalPostUrl(value) {
    for (const variant of decodedVariants(value)) {
      try {
        const url = new URL(variant, "https://www.linkedin.com");
        if (!["linkedin.com", "www.linkedin.com"].includes(url.hostname)) continue;
        if (url.pathname.startsWith("/posts/") || url.pathname.startsWith("/feed/update/") || url.pathname.startsWith("/pulse/")) {
          return `https://www.linkedin.com${url.pathname.replace(/\/$/, "")}`;
        }
      } catch (_error) {
        // Continue to activity-id recovery.
      }
      const activity = /(?:urn:li:activity:|activity[-_:])([0-9]{12,})/i.exec(variant);
      if (activity) return `https://www.linkedin.com/feed/update/urn:li:activity:${activity[1]}`;
    }
    return "";
  }

  function styleAllowsRendering(element) {
    if (!(element instanceof Element) || !element.isConnected) return false;
    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
  }

  function largestRect(rects) {
    let best = null;
    for (const rect of rects || []) {
      if (!rect || rect.width <= 0 || rect.height <= 0) continue;
      if (!best || rect.width * rect.height > best.width * best.height) best = rect;
    }
    return best;
  }

  function renderedRect(element) {
    if (!styleAllowsRendering(element)) return null;
    const own = largestRect(element.getClientRects());
    if (own) return own;
    const descendants = element.querySelectorAll("span, time, strong, small, svg, img");
    for (let index = 0; index < Math.min(descendants.length, 30); index += 1) {
      const child = descendants[index];
      if (!styleAllowsRendering(child)) continue;
      const rect = largestRect(child.getClientRects());
      if (rect) return rect;
    }
    return null;
  }

  function isVisible(element) {
    return Boolean(renderedRect(element));
  }

  function elementValues(element, ancestorDepth = 3) {
    const values = [];
    let node = element;
    for (let depth = 0; node instanceof Element && depth <= ancestorDepth; depth += 1, node = node.parentElement) {
      if (node instanceof HTMLAnchorElement) values.push(node.href || node.getAttribute("href") || "");
      for (const attribute of node.attributes || []) values.push(String(attribute.value || ""));
    }
    return values.filter(Boolean);
  }

  function canonicalFromElement(element) {
    for (const value of elementValues(element, 5)) {
      const canonical = canonicalPostUrl(value);
      if (canonical) return canonical;
    }
    return "";
  }

  function canonicalAnchors() {
    const anchors = [];
    const selector = 'a[href], [role="link"], time, [data-test-id*="timestamp"]';
    for (const node of document.querySelectorAll(selector)) {
      const canonical = canonicalFromElement(node);
      if (!canonical) continue;
      const rect = renderedRect(node);
      if (!rect) continue;
      anchors.push({
        node,
        canonical,
        rect,
        text: normalize(node.innerText || node.textContent || ""),
        label: normalize(node.getAttribute("aria-label") || node.getAttribute("title") || "")
      });
    }
    return anchors;
  }

  function anchorMatchesCard(cardRect, anchorRect) {
    const centerX = anchorRect.left + anchorRect.width / 2;
    const centerY = anchorRect.top + anchorRect.height / 2;
    return centerY >= cardRect.top - 64
      && centerY <= cardRect.bottom + 64
      && centerX >= cardRect.left - 120
      && centerX <= cardRect.right + 120;
  }

  function directCardLink(card) {
    const existing = canonicalPostUrl(card.getAttribute("data-codistan-canonical-url") || "");
    if (existing) return existing;

    for (const node of card.querySelectorAll('a[href], [role="link"], time, [data-test-id*="timestamp"]')) {
      const canonical = canonicalFromElement(node);
      if (canonical) return canonical;
    }

    const cardRect = renderedRect(card) || card.getBoundingClientRect();
    let parent = card.parentElement;
    for (let depth = 0; parent instanceof Element && depth < 14; depth += 1, parent = parent.parentElement) {
      for (const node of parent.querySelectorAll('a[href], [role="link"], time, [data-test-id*="timestamp"]')) {
        const text = normalize(node.innerText || node.textContent || "");
        const label = normalize(node.getAttribute("aria-label") || node.getAttribute("title") || "");
        if (!AGE_TEXT.test(text) && !/\b(?:ago|post)\b/i.test(label)) continue;
        const rect = renderedRect(node);
        if (!rect || !anchorMatchesCard(cardRect, rect)) continue;
        const canonical = canonicalFromElement(node);
        if (canonical) return canonical;
      }
      if (parent.matches("main, [role='main']")) break;
    }
    return "";
  }

  function spatialCardLink(card, anchors) {
    const cardRect = renderedRect(card) || card.getBoundingClientRect();
    let best = null;
    for (const item of anchors) {
      if (!anchorMatchesCard(cardRect, item.rect)) continue;
      const centerX = item.rect.left + item.rect.width / 2;
      const centerY = item.rect.top + item.rect.height / 2;
      const ageBonus = AGE_TEXT.test(item.text) || /\b(?:ago|post)\b/i.test(item.label) ? -300 : 0;
      const distance = Math.abs(centerY - (cardRect.top + 42)) + Math.abs(centerX - cardRect.left) * 0.15 + ageBonus;
      if (!best || distance < best.distance) best = {distance, canonical: item.canonical};
    }
    return best?.canonical || "";
  }

  function resolveVisibleCards() {
    const anchors = canonicalAnchors();
    let resolved = 0;
    let visibleCards = 0;
    for (const card of document.querySelectorAll(CARD_SELECTOR)) {
      if (!isVisible(card)) continue;
      visibleCards += 1;
      const canonical = directCardLink(card) || spatialCardLink(card, anchors);
      if (canonical) {
        card.setAttribute("data-codistan-canonical-url", canonical);
        resolved += 1;
      } else {
        card.removeAttribute("data-codistan-canonical-url");
      }
    }
    return {visible_cards: visibleCards, resolved_cards: resolved, canonical_anchors: anchors.length};
  }

  function clampNumber(value, minimum, maximum, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(maximum, Math.max(minimum, parsed));
  }

  function sleep(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
  }

  function documentScroller(element) {
    return element === document.scrollingElement || element === document.documentElement || element === document.body;
  }

  function scrollerTop(element) {
    return documentScroller(element) ? Number(window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0) : Number(element.scrollTop || 0);
  }

  function scrollerHeight(element) {
    if (documentScroller(element)) {
      return Math.max(
        Number(document.documentElement.scrollHeight || 0),
        Number(document.body?.scrollHeight || 0),
        Number(element?.scrollHeight || 0)
      );
    }
    return Number(element.scrollHeight || 0);
  }

  function scrollerViewport(element) {
    return documentScroller(element) ? Math.max(300, Number(window.innerHeight || document.documentElement.clientHeight || 800)) : Math.max(300, Number(element.clientHeight || 0));
  }

  function scrollerWidth(element) {
    return documentScroller(element) ? Math.max(300, Number(window.innerWidth || document.documentElement.clientWidth || 1200)) : Math.max(100, Number(element.clientWidth || 0));
  }

  function setScrollerTop(element, top, behavior = "auto") {
    if (documentScroller(element)) window.scrollTo({top, behavior});
    else element.scrollTo({top, behavior});
  }

  function scrollCandidates() {
    const candidates = new Set();
    if (document.scrollingElement) candidates.add(document.scrollingElement);
    candidates.add(document.documentElement);
    if (document.body) candidates.add(document.body);

    const cards = [...document.querySelectorAll(CARD_SELECTOR)];
    for (const card of cards) {
      let node = card.parentElement;
      for (let depth = 0; node instanceof Element && depth < 18; depth += 1, node = node.parentElement) {
        candidates.add(node);
        if (node.matches("main, [role='main']")) candidates.add(node);
      }
    }

    const ranked = [];
    for (const element of candidates) {
      if (!(element instanceof Element)) continue;
      const height = scrollerHeight(element);
      const viewport = scrollerViewport(element);
      const range = Math.max(0, height - viewport);
      if (range <= 40) continue;
      const cardCount = cards.filter(card => element.contains(card)).length;
      const style = window.getComputedStyle(element);
      const overflowY = String(style.overflowY || "");
      const overflowBonus = /auto|scroll|overlay/i.test(overflowY) ? 500000 : 0;
      const documentBonus = documentScroller(element) ? 250000 : 0;
      const score = cardCount * 1000000 + overflowBonus + documentBonus + Math.min(range, 200000) + Math.min(scrollerWidth(element) * viewport, 500000);
      ranked.push({element, range, card_count: cardCount, score, kind: documentScroller(element) ? "document" : `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}`});
    }
    ranked.sort((a, b) => b.score - a.score);
    return ranked;
  }

  function currentScrollStatus() {
    const candidates = scrollCandidates();
    const chosen = candidates[0] || {element: document.scrollingElement || document.documentElement, range: 0, card_count: 0, kind: "document"};
    return {
      element: chosen.element,
      top: scrollerTop(chosen.element),
      height: scrollerHeight(chosen.element),
      viewport: scrollerViewport(chosen.element),
      range: chosen.range,
      scroller_kind: chosen.kind,
      scroller_candidates: candidates.length,
      scroller_card_count: chosen.card_count
    };
  }

  async function scrollOneStep(message = {}) {
    const url = new URL(window.location.href);
    if (!url.pathname.startsWith("/search/results/content")) {
      throw new Error("Bounded scrolling is available only on LinkedIn content-search pages.");
    }

    const waitMs = clampNumber(message.wait_ms, MIN_WAIT_MS, MAX_WAIT_MS, DEFAULT_WAIT_MS);
    const ranked = scrollCandidates();
    if (!ranked.length) {
      const cards = resolveVisibleCards();
      return {ok: true, moved: false, at_end: true, before_top: 0, after_top: 0, before_height: 0, after_height: 0, scroller_kind: "none", scroller_candidates: 0, ...cards};
    }

    for (const candidate of ranked.slice(0, 6)) {
      const scroller = candidate.element;
      const beforeTop = scrollerTop(scroller);
      const beforeHeight = scrollerHeight(scroller);
      const viewport = scrollerViewport(scroller);
      const stepPixels = clampNumber(message.step_pixels, 500, 1400, Math.round(viewport * 0.85));
      const maximumTop = Math.max(0, beforeHeight - viewport);
      const targetTop = Math.min(maximumTop, beforeTop + stepPixels);
      if (targetTop <= beforeTop + 8) continue;

      setScrollerTop(scroller, targetTop, "smooth");
      await sleep(waitMs);
      const afterTop = scrollerTop(scroller);
      const afterHeight = scrollerHeight(scroller);
      if (afterTop <= beforeTop + 8) continue;

      const cards = resolveVisibleCards();
      return {
        ok: true,
        moved: true,
        at_end: afterTop >= Math.max(0, afterHeight - viewport - 12),
        before_top: beforeTop,
        after_top: afterTop,
        before_height: beforeHeight,
        after_height: afterHeight,
        scroller_kind: candidate.kind,
        scroller_candidates: ranked.length,
        scroller_card_count: candidate.card_count,
        ...cards
      };
    }

    const status = currentScrollStatus();
    const cards = resolveVisibleCards();
    return {
      ok: true,
      moved: false,
      at_end: status.top >= Math.max(0, status.height - status.viewport - 12),
      before_top: status.top,
      after_top: status.top,
      before_height: status.height,
      after_height: status.height,
      scroller_kind: status.scroller_kind,
      scroller_candidates: status.scroller_candidates,
      scroller_card_count: status.scroller_card_count,
      ...cards
    };
  }

  function restoreScroll(message = {}) {
    const top = clampNumber(message.top, 0, 100000000, 0);
    const status = currentScrollStatus();
    setScrollerTop(status.element, top, "auto");
    const cards = resolveVisibleCards();
    return {ok: true, restored_top: top, scroller_kind: status.scroller_kind, ...cards};
  }

  let pendingResolve = null;
  function scheduleResolve() {
    if (pendingResolve) clearTimeout(pendingResolve);
    pendingResolve = setTimeout(() => {
      pendingResolve = null;
      resolveVisibleCards();
    }, 250);
  }

  const observer = new MutationObserver(scheduleResolve);
  observer.observe(document.documentElement, {childList: true, subtree: true, attributes: true, attributeFilter: ["href", "data-urn", "data-id", "aria-label", "title"]});
  scheduleResolve();

  globalThis.CodistanLinkedInSearchResolver = {
    resolveVisibleCards,
    currentScrollStatus
  };

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message) return false;
    if (message.type === "CODISTAN_RESOLVE_LINKEDIN_LINKS") {
      sendResponse({ok: true, ...resolveVisibleCards()});
      return false;
    }
    if (message.type === "CODISTAN_LINKEDIN_SCROLL_STATUS") {
      const status = currentScrollStatus();
      sendResponse({
        ok: true,
        top: status.top,
        height: status.height,
        viewport: status.viewport,
        range: status.range,
        scroller_kind: status.scroller_kind,
        scroller_candidates: status.scroller_candidates,
        scroller_card_count: status.scroller_card_count,
        ...resolveVisibleCards()
      });
      return false;
    }
    if (message.type === "CODISTAN_RESTORE_LINKEDIN_SCROLL") {
      sendResponse(restoreScroll(message));
      return false;
    }
    if (message.type !== "CODISTAN_SCROLL_LINKEDIN_RESULTS") return false;
    scrollOneStep(message)
      .then(sendResponse)
      .catch(error => sendResponse({ok: false, error: error instanceof Error ? error.message : String(error)}));
    return true;
  });
})();