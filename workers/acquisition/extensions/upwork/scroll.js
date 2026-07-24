(() => {
  "use strict";

  const JOB_LINK_SELECTOR = 'a[href^="/jobs/"], a[href*="/jobs/~"], a[href*="/freelance-jobs/apply/"]';
  const CARD_SELECTORS = [
    'article[data-test="JobTile"]',
    'section[data-test="job-tile"]',
    '[data-test="job-tile-list"] article',
    '[data-test="job-tile"]',
    '[data-test*="JobTile"]',
    '[data-test*="job-tile"]',
    'article.job-tile'
  ];

  function sleep(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(milliseconds) || 0)));
  }

  function isVisible(element) {
    if (!(element instanceof Element)) return false;
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
  }

  function isDocumentScroller(element) {
    return element === document.scrollingElement
      || element === document.documentElement
      || element === document.body;
  }

  function labelFor(element) {
    if (!element) return "unknown";
    if (isDocumentScroller(element)) return "document.scrollingElement";
    const id = element.id ? `#${element.id}` : "";
    const classes = String(element.className || "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 3)
      .map(value => `.${value}`)
      .join("");
    return `${String(element.tagName || "element").toLowerCase()}${id}${classes}`;
  }

  function metrics(element) {
    const documentScroller = isDocumentScroller(element);
    const top = documentScroller
      ? Number(document.scrollingElement?.scrollTop || document.documentElement.scrollTop || document.body.scrollTop || 0)
      : Number(element?.scrollTop || 0);
    const height = documentScroller
      ? Number(document.scrollingElement?.scrollHeight || document.documentElement.scrollHeight || document.body.scrollHeight || 0)
      : Number(element?.scrollHeight || 0);
    const clientHeight = documentScroller
      ? Number(window.innerHeight || document.documentElement.clientHeight || 0)
      : Number(element?.clientHeight || 0);
    return {
      top,
      height,
      client_height: clientHeight,
      at_end: height > 0 && top + clientHeight >= height - 24
    };
  }

  function setTop(element, top) {
    const value = Math.max(0, Number(top) || 0);
    if (isDocumentScroller(element)) {
      if (document.scrollingElement) document.scrollingElement.scrollTop = value;
      document.documentElement.scrollTop = value;
      if (document.body) document.body.scrollTop = value;
      return;
    }
    element.scrollTop = value;
  }

  function visibleJobCards() {
    const found = [];
    const seen = new Set();
    for (const selector of CARD_SELECTORS) {
      for (const node of document.querySelectorAll(selector)) {
        if (!seen.has(node) && isVisible(node) && node.querySelector(JOB_LINK_SELECTOR)) {
          seen.add(node);
          found.push(node);
        }
      }
    }
    if (found.length) return found;
    for (const link of document.querySelectorAll(JOB_LINK_SELECTOR)) {
      if (!isVisible(link)) continue;
      const card = link.closest('article, section, [data-test*="job" i], [class*="job" i]');
      if (card && !seen.has(card) && isVisible(card)) {
        seen.add(card);
        found.push(card);
      }
    }
    return found;
  }

  function candidateScrollers() {
    const candidates = [];
    const seen = new Set();
    const add = element => {
      if (!element || seen.has(element)) return;
      seen.add(element);
      candidates.push(element);
    };

    add(document.scrollingElement || document.documentElement);
    for (const card of visibleJobCards().slice(0, 8)) {
      let node = card.parentElement;
      for (let depth = 0; depth < 10 && node; depth += 1) {
        const style = window.getComputedStyle(node);
        const scrollable = /(auto|scroll|overlay)/i.test(`${style.overflowY} ${style.overflow}`)
          && Number(node.scrollHeight || 0) > Number(node.clientHeight || 0) + 80;
        if (scrollable) add(node);
        node = node.parentElement;
      }
    }

    for (const node of document.querySelectorAll('main, [role="main"], [data-test*="search" i], [class*="scroll" i]')) {
      if (!(node instanceof Element)) continue;
      const style = window.getComputedStyle(node);
      if (/(auto|scroll|overlay)/i.test(`${style.overflowY} ${style.overflow}`)
        && Number(node.scrollHeight || 0) > Number(node.clientHeight || 0) + 80) add(node);
    }
    return candidates;
  }

  function scoreScroller(element) {
    const current = metrics(element);
    if (current.height <= current.client_height + 80) return Number.NEGATIVE_INFINITY;
    let containedCards = 0;
    for (const card of visibleJobCards()) {
      if (isDocumentScroller(element) || element.contains(card)) containedCards += 1;
    }
    const remaining = Math.max(0, current.height - current.client_height - current.top);
    const scrollability = Math.min(30, remaining / Math.max(1, current.client_height));
    const semantic = isDocumentScroller(element) ? 5 : 12;
    return containedCards * 25 + scrollability + semantic;
  }

  function selectScroller() {
    const ranked = candidateScrollers()
      .map(element => ({element, score: scoreScroller(element)}))
      .filter(candidate => Number.isFinite(candidate.score))
      .sort((left, right) => right.score - left.score);
    return ranked[0]?.element || document.scrollingElement || document.documentElement;
  }

  async function scrollResults(waitMs) {
    const scroller = selectScroller();
    const before = metrics(scroller);
    if (before.at_end) {
      return {
        ok: true,
        moved: false,
        reason: "end_of_results",
        scroller: labelFor(scroller),
        before_top: before.top,
        after_top: before.top,
        before_height: before.height,
        after_height: before.height,
        at_end: true
      };
    }

    const increment = Math.max(520, Math.floor(before.client_height * 0.82));
    setTop(scroller, Math.min(before.height, before.top + increment));
    await sleep(waitMs);
    const after = metrics(scroller);
    const moved = after.top > before.top + 8 || after.height > before.height + 20;
    return {
      ok: true,
      moved,
      reason: moved ? "moved" : "no_movable_scroll_container",
      scroller: labelFor(scroller),
      before_top: before.top,
      after_top: after.top,
      before_height: before.height,
      after_height: after.height,
      client_height: after.client_height,
      at_end: after.at_end
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message) return false;
    if (message.type === "CODISTAN_UPWORK_SCROLL_STATUS") {
      const scroller = selectScroller();
      sendResponse({ok: true, scroller: labelFor(scroller), ...metrics(scroller)});
      return false;
    }
    if (message.type === "CODISTAN_SCROLL_UPWORK_RESULTS") {
      scrollResults(message.wait_ms)
        .then(sendResponse)
        .catch(error => sendResponse({ok: false, error: error instanceof Error ? error.message : String(error)}));
      return true;
    }
    if (message.type === "CODISTAN_RESTORE_UPWORK_SCROLL") {
      try {
        const scroller = selectScroller();
        setTop(scroller, message.top);
        sendResponse({ok: true, scroller: labelFor(scroller), ...metrics(scroller)});
      } catch (error) {
        sendResponse({ok: false, error: error instanceof Error ? error.message : String(error)});
      }
      return false;
    }
    return false;
  });
})();
