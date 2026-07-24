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

  function isVisible(element) {
    if (!(element instanceof Element)) return false;
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
  }

  function canonicalAnchors() {
    const anchors = [];
    for (const anchor of document.querySelectorAll("a[href]")) {
      const canonical = canonicalPostUrl(anchor.href || anchor.getAttribute("href") || "");
      if (!canonical || !isVisible(anchor)) continue;
      const rect = anchor.getBoundingClientRect();
      anchors.push({
        anchor,
        canonical,
        rect,
        text: normalize(anchor.innerText || anchor.textContent || ""),
        label: normalize(anchor.getAttribute("aria-label") || anchor.getAttribute("title") || "")
      });
    }
    return anchors;
  }

  function anchorMatchesCard(cardRect, anchorRect) {
    const centerX = anchorRect.left + anchorRect.width / 2;
    const centerY = anchorRect.top + anchorRect.height / 2;
    return centerY >= cardRect.top - 48
      && centerY <= cardRect.bottom + 48
      && centerX >= cardRect.left - 90
      && centerX <= cardRect.right + 90;
  }

  function directCardLink(card) {
    const cardRect = card.getBoundingClientRect();
    for (const anchor of card.querySelectorAll("a[href]")) {
      const canonical = canonicalPostUrl(anchor.href || anchor.getAttribute("href") || "");
      if (canonical) return canonical;
    }
    let parent = card.parentElement;
    for (let depth = 0; parent instanceof Element && depth < 8; depth += 1, parent = parent.parentElement) {
      if (parent.matches("main, [role='main']")) break;
      for (const anchor of parent.querySelectorAll("a[href]")) {
        const text = normalize(anchor.innerText || anchor.textContent || "");
        const label = normalize(anchor.getAttribute("aria-label") || anchor.getAttribute("title") || "");
        if (!AGE_TEXT.test(text) && !/\b(?:ago|post)\b/i.test(label)) continue;
        if (!anchorMatchesCard(cardRect, anchor.getBoundingClientRect())) continue;
        const canonical = canonicalPostUrl(anchor.href || anchor.getAttribute("href") || "");
        if (canonical) return canonical;
      }
    }
    return "";
  }

  function spatialCardLink(card, anchors) {
    const cardRect = card.getBoundingClientRect();
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
    return {visible_cards: visibleCards, resolved_cards: resolved};
  }

  function scrollingElement() {
    return document.scrollingElement || document.documentElement;
  }

  function clampNumber(value, minimum, maximum, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(maximum, Math.max(minimum, parsed));
  }

  function sleep(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
  }

  async function scrollOneStep(message = {}) {
    const url = new URL(window.location.href);
    if (!url.pathname.startsWith("/search/results/content")) {
      throw new Error("Bounded scrolling is available only on LinkedIn content-search pages.");
    }
    const scroller = scrollingElement();
    const beforeTop = Number(scroller.scrollTop || window.scrollY || 0);
    const beforeHeight = Number(scroller.scrollHeight || document.documentElement.scrollHeight || 0);
    const viewport = Math.max(600, Number(window.innerHeight || 800));
    const stepPixels = clampNumber(message.step_pixels, 500, 1400, Math.round(viewport * 0.85));
    const maximumTop = Math.max(0, beforeHeight - viewport);
    const targetTop = Math.min(maximumTop, beforeTop + stepPixels);
    if (targetTop <= beforeTop + 8) {
      const cards = resolveVisibleCards();
      return {ok: true, moved: false, at_end: true, before_top: beforeTop, after_top: beforeTop, before_height: beforeHeight, after_height: beforeHeight, ...cards};
    }
    window.scrollTo({top: targetTop, behavior: "smooth"});
    const waitMs = clampNumber(message.wait_ms, MIN_WAIT_MS, MAX_WAIT_MS, DEFAULT_WAIT_MS);
    await sleep(waitMs);
    const cards = resolveVisibleCards();
    const afterTop = Number(scroller.scrollTop || window.scrollY || 0);
    const afterHeight = Number(scroller.scrollHeight || document.documentElement.scrollHeight || 0);
    return {
      ok: true,
      moved: afterTop > beforeTop + 8,
      at_end: afterTop >= Math.max(0, afterHeight - viewport - 12),
      before_top: beforeTop,
      after_top: afterTop,
      before_height: beforeHeight,
      after_height: afterHeight,
      ...cards
    };
  }

  function restoreScroll(message = {}) {
    const top = clampNumber(message.top, 0, 100000000, 0);
    window.scrollTo({top, behavior: "auto"});
    const cards = resolveVisibleCards();
    return {ok: true, restored_top: top, ...cards};
  }

  let pendingResolve = null;
  function scheduleResolve() {
    if (pendingResolve) clearTimeout(pendingResolve);
    pendingResolve = setTimeout(() => {
      pendingResolve = null;
      resolveVisibleCards();
    }, 350);
  }

  const observer = new MutationObserver(scheduleResolve);
  observer.observe(document.documentElement, {childList: true, subtree: true, attributes: true, attributeFilter: ["href", "data-urn", "data-id"]});
  scheduleResolve();

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message) return false;
    if (message.type === "CODISTAN_LINKEDIN_SCROLL_STATUS") {
      const scroller = scrollingElement();
      sendResponse({
        ok: true,
        top: Number(scroller.scrollTop || window.scrollY || 0),
        height: Number(scroller.scrollHeight || document.documentElement.scrollHeight || 0),
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
