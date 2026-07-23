(() => {
  "use strict";

  const signal = globalThis.CodistanLinkedInSignal;
  if (!signal) return;

  const MARKER = "data-codistan-opportunity-card";
  const INTENT_HINT = /\b(?:looking for|seeking|need(?:ing)?|calling|request for proposal|rfp|expression of interest|eoi|outsourc(?:e|ing)|development partner|implementation partner|agency|studio|consultant|project[- ]based engagements?)\b/i;
  let scheduled = 0;

  function visible(element) {
    if (!(element instanceof Element)) return false;
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
  }

  function normalizedText(element) {
    return signal.normalizeText(element?.innerText || element?.textContent || "");
  }

  function hasActorLink(element) {
    return Boolean(element.querySelector('a[href*="/in/"], a[href*="/company/"]'));
  }

  function plausibleCard(element) {
    if (!visible(element) || element === document.body || element === document.documentElement) return false;
    const rect = element.getBoundingClientRect();
    if (rect.width < 280 || rect.width > 1100 || rect.height < 90 || rect.height > 1800) return false;
    const text = normalizedText(element);
    if (text.length < 35 || text.length > 14000 || !INTENT_HINT.test(text)) return false;
    if (!hasActorLink(element)) return false;
    return signal.classifyOpportunity(text).candidate;
  }

  function nearestCard(start) {
    let node = start instanceof Element ? start : start?.parentElement;
    let best = null;
    for (let depth = 0; node && depth < 14; depth += 1, node = node.parentElement) {
      if (plausibleCard(node)) {
        best = node;
        break;
      }
    }
    return best;
  }

  function annotate() {
    scheduled = 0;
    const scope = document.querySelector("main") || document.body;
    if (!scope) return;

    let inspected = 0;
    for (const element of scope.querySelectorAll("span, p, div, a")) {
      if (inspected >= 7000) break;
      inspected += 1;
      if (!visible(element)) continue;
      const text = normalizedText(element);
      if (text.length < 20 || text.length > 1600 || !INTENT_HINT.test(text)) continue;
      const card = nearestCard(element);
      if (!card || card.hasAttribute(MARKER)) continue;
      card.setAttribute(MARKER, "true");
      if (!card.hasAttribute("data-view-name")) card.setAttribute("data-view-name", "feed-full-update");
    }
  }

  function schedule() {
    if (scheduled) window.clearTimeout(scheduled);
    scheduled = window.setTimeout(annotate, 250);
  }

  schedule();
  window.setTimeout(annotate, 1500);
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, {childList: true, subtree: true});
})();
