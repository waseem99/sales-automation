(() => {
  "use strict";

  const signal = globalThis.CodistanLinkedInSignal;
  if (!signal) return;

  const MARKER = "data-codistan-opportunity-card";
  const ACTOR_SELECTOR = 'a[href*="/in/"], a[href*="/company/"]';
  const INTENT_HINT = /\b(?:looking for|seeking|need(?:ing)?|calling|request for proposal|rfp|expression of interest|eoi|outsourc(?:e|ing)|development partner|implementation partner|service providers?|agency|studio|consultant|project[- ]based engagements?)\b/i;
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

  function canonicalActorHref(anchor) {
    try {
      const url = new URL(anchor?.href || anchor?.getAttribute?.("href") || "", "https://www.linkedin.com");
      if (!["linkedin.com", "www.linkedin.com"].includes(url.hostname)) return "";
      if (!url.pathname.startsWith("/in/") && !url.pathname.startsWith("/company/")) return "";
      return `${url.hostname}${url.pathname.replace(/\/$/, "")}`.toLowerCase();
    } catch (_error) {
      return "";
    }
  }

  function distinctActorHrefs(element) {
    const values = new Set();
    for (const anchor of element.querySelectorAll(ACTOR_SELECTOR)) {
      if (!visible(anchor)) continue;
      const href = canonicalActorHref(anchor);
      if (href) values.add(href);
      if (values.size > 6) break;
    }
    return values;
  }

  function activityEvidence(element) {
    const html = String(element?.outerHTML || "").slice(0, 300000);
    return /(?:\/posts\/|\/feed\/update\/|urn(?::|%3a)li(?::|%3a)activity(?::|%3a)\d{12,}|activity[-_:]\d{12,})/i.test(html);
  }

  function plausibleCard(element) {
    if (!visible(element) || element === document.body || element === document.documentElement) return false;
    const rect = element.getBoundingClientRect();
    if (rect.width < 300 || rect.width > 920 || rect.height < 95 || rect.height > 1350) return false;
    const text = normalizedText(element);
    if (text.length < 35 || text.length > 9000 || !INTENT_HINT.test(text)) return false;
    const actors = distinctActorHrefs(element);
    if (actors.size < 1 || actors.size > 6) return false;
    return signal.classifyOpportunity(text).candidate;
  }

  function nearestCardFromActor(actorLink) {
    const candidates = [];
    let node = actorLink instanceof Element ? actorLink.parentElement : null;
    for (let depth = 0; node && depth < 18; depth += 1, node = node.parentElement) {
      if (plausibleCard(node)) candidates.push(node);
    }
    if (!candidates.length) return null;
    candidates.sort((left, right) => {
      const leftActors = distinctActorHrefs(left).size;
      const rightActors = distinctActorHrefs(right).size;
      if (leftActors !== rightActors) return leftActors - rightActors;
      const leftEvidence = activityEvidence(left) ? 0 : 1;
      const rightEvidence = activityEvidence(right) ? 0 : 1;
      if (leftEvidence !== rightEvidence) return leftEvidence - rightEvidence;
      const leftRect = left.getBoundingClientRect();
      const rightRect = right.getBoundingClientRect();
      return (leftRect.width * leftRect.height) - (rightRect.width * rightRect.height);
    });
    return candidates[0];
  }

  function pruneNestedCards(cards) {
    const ordered = [...cards].sort((left, right) => {
      const a = left.getBoundingClientRect();
      const b = right.getBoundingClientRect();
      return (a.width * a.height) - (b.width * b.height);
    });
    const selected = [];
    for (const card of ordered) {
      if (selected.some(existing => existing === card || existing.contains(card) || card.contains(existing))) continue;
      selected.push(card);
    }
    return selected;
  }

  function annotate() {
    scheduled = 0;
    const scope = document.querySelector("main") || document.body;
    if (!scope) return;

    for (const marked of scope.querySelectorAll(`[${MARKER}]`)) marked.removeAttribute(MARKER);

    const candidates = new Set();
    const actorSeeds = new Set();
    for (const anchor of scope.querySelectorAll(ACTOR_SELECTOR)) {
      if (!visible(anchor)) continue;
      const href = canonicalActorHref(anchor);
      if (!href) continue;
      const seedKey = `${href}:${Math.round(anchor.getBoundingClientRect().top)}`;
      if (actorSeeds.has(seedKey)) continue;
      actorSeeds.add(seedKey);
      const card = nearestCardFromActor(anchor);
      if (card) candidates.add(card);
    }

    for (const card of pruneNestedCards(candidates)) card.setAttribute(MARKER, "true");
  }

  function schedule() {
    if (scheduled) window.clearTimeout(scheduled);
    scheduled = window.setTimeout(annotate, 300);
  }

  schedule();
  window.setTimeout(annotate, 1600);
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, {childList: true, subtree: true});
})();