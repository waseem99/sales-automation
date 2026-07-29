(() => {
  "use strict";

  const evidence = globalThis.CodistanUpworkEvidence;
  if (!evidence) return;

  const APPROVED_SAVED_SEARCH_NAMES = [
    "AI + Fullstack AI 16 July 2026",
    "3D Design & Creatives 15 July 2026",
    "Game & AR/VR 16 July 2026"
  ];

  const CARD_SELECTORS = [
    'article[data-test="JobTile"]',
    'section[data-test="job-tile"]',
    '[data-test="job-tile-list"] article',
    'article.job-tile',
    '[data-test="job-tile"]',
    '[data-test*="JobTile"]',
    '[data-test*="job-tile"]',
    '[data-ev-label="search_results"] > div',
    'section[class*="job"]',
    'article'
  ];

  const TITLE_LINK_SELECTORS = [
    'a[data-test="job-tile-title-link"]',
    'a[data-test*="title-link"]',
    'h2 a[href]',
    'h3 a[href]',
    'a[href*="~"]'
  ];

  const DESCRIPTION_SELECTORS = [
    '[data-test="UpCLineClamp JobDescription"]',
    '[data-test="job-description"]',
    '[data-test="job-description-text"]',
    '[data-test*="description"]',
    '[class*="description"]',
    '[class*="line-clamp"]',
    'p'
  ];

  const SKILL_SELECTORS = [
    '[data-test="TokenClamp"] a',
    '[data-test="Skill"]',
    '[data-test*="skill"]',
    'a[href*="ontology_skill"]',
    'button[data-test*="skill"]',
    '[class*="token"]'
  ];

  const JOB_CARD_CUES = [
    'posted ', 'proposal', 'payment verified', 'payment unverified',
    'est. budget', 'hourly', 'fixed-price', 'spent',
    'intermediate', 'expert', 'entry level'
  ];

  const JUNK_MARKERS = [
    'job feedback', 'just not interested', 'vague description',
    'unrealistic expectations', 'too many applicants',
    'job posted too long ago', 'poor reviews about the client',
    "doesn't match skills", 'i am overqualified', 'budget too low',
    'not in my preferred location', 'the client will not be notified',
    'your feedback helps us improve job search'
  ];

  function isVisible(element) {
    if (!(element instanceof Element)) return false;
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  }

  function cutJunkTail(value) {
    const text = evidence.normalizeText(value);
    const lowered = text.toLowerCase();
    const indexes = JUNK_MARKERS.map(marker => lowered.indexOf(marker)).filter(index => index >= 0);
    return indexes.length ? text.slice(0, Math.min(...indexes)).trim() : text;
  }

  function firstVisible(root, selectors) {
    for (const selector of selectors) {
      const node = root.querySelector(selector);
      if (node && isVisible(node)) return node;
    }
    return null;
  }

  function isSelectedSearchControl(node) {
    const controls = [node, node.closest('button, a, [role="tab"], [role="button"]')].filter(Boolean);
    return controls.some(control => {
      const ariaSelected = String(control.getAttribute("aria-selected") || "").toLowerCase();
      const ariaPressed = String(control.getAttribute("aria-pressed") || "").toLowerCase();
      const ariaCurrent = String(control.getAttribute("aria-current") || "").toLowerCase();
      const stateText = [control.className, control.getAttribute("data-test"), control.getAttribute("data-qa")]
        .map(value => String(value || "").toLowerCase())
        .join(" ");
      return ariaSelected === "true" || ariaPressed === "true" || ariaCurrent === "page" || /(^|\s)(active|selected|current)(\s|$)/.test(stateText);
    });
  }

  function activeSavedSearchName() {
    const candidates = [];
    for (const node of document.querySelectorAll('button, a, [role="tab"], [role="button"], span')) {
      if (!isVisible(node)) continue;
      const text = evidence.normalizeText(node.textContent);
      if (!APPROVED_SAVED_SEARCH_NAMES.includes(text)) continue;
      candidates.push({name: text, selected: isSelectedSearchControl(node)});
    }
    const selected = candidates.find(candidate => candidate.selected);
    if (selected) return selected.name;
    const titleText = evidence.normalizeText(document.title);
    return APPROVED_SAVED_SEARCH_NAMES.find(name => titleText.includes(name)) || "";
  }

  function visibleApprovedSearchNames() {
    const names = new Set();
    for (const node of document.querySelectorAll('button, a, [role="tab"], [role="button"], span')) {
      if (!isVisible(node)) continue;
      const text = evidence.normalizeText(node.textContent);
      if (APPROVED_SAVED_SEARCH_NAMES.includes(text)) names.add(text);
    }
    return Array.from(names);
  }

  function canonicalJobUrl(href) {
    try {
      const url = new URL(href, "https://www.upwork.com");
      if (!["upwork.com", "www.upwork.com"].includes(url.hostname)) return null;
      if (!url.pathname.startsWith('/jobs/') && !url.pathname.startsWith('/freelance-jobs/apply/')) return null;
      if (!evidence.nativeIdFromUrl(url.href)) return null;
      return `https://www.upwork.com${url.pathname.replace(/\/$/, "")}`;
    } catch (_error) {
      return null;
    }
  }

  function jobIdFromHref(href) {
    const url = canonicalJobUrl(href);
    return url ? evidence.nativeIdFromUrl(url) : "";
  }

  function uniqueJobIds(node) {
    return new Set(
      Array.from(node.querySelectorAll('a[href]'))
        .map(anchor => jobIdFromHref(anchor.getAttribute('href')))
        .filter(Boolean)
    );
  }

  function cueCount(text) {
    const lowered = text.toLowerCase();
    return JOB_CARD_CUES.reduce((count, cue) => count + (lowered.includes(cue) ? 1 : 0), 0);
  }

  function deriveCardFromLink(link) {
    let node = link;
    let best = null;
    let bestScore = Number.NEGATIVE_INFINITY;
    const targetId = jobIdFromHref(link.getAttribute('href'));
    if (!targetId) return null;

    for (let depth = 0; depth < 12 && node && node !== document.body; depth += 1) {
      node = node.parentElement;
      if (!node || !isVisible(node)) continue;
      const text = evidence.normalizeText(node.textContent);
      if (text.length < 100 || text.length > 20000) continue;
      const ids = uniqueJobIds(node);
      if (ids.size !== 1 || !ids.has(targetId)) continue;
      const cues = cueCount(text);
      if (cues < 2) continue;
      const lowered = text.toLowerCase();
      const junkPenalty = JUNK_MARKERS.some(marker => lowered.includes(marker)) ? 30 : 0;
      const semanticBonus = node.matches('article, section, [data-test*="job" i], [class*="job" i]') ? 12 : 0;
      const commercialBonus = evidence.evidenceScore(text) * 20;
      const lengthPenalty = Math.max(0, text.length - 9000) / 400;
      const score = cues * 10 + semanticBonus + commercialBonus - junkPenalty - lengthPenalty;
      if (score > bestScore) {
        best = node;
        bestScore = score;
      }
    }
    return best;
  }

  function collectCandidateCards() {
    const cardNodes = [];
    const nodeSet = new Set();
    for (const selector of CARD_SELECTORS) {
      for (const node of document.querySelectorAll(selector)) {
        if (!nodeSet.has(node) && isVisible(node) && uniqueJobIds(node).size === 1) {
          nodeSet.add(node);
          cardNodes.push(node);
        }
      }
    }
    for (const link of document.querySelectorAll('a[href]')) {
      if (!isVisible(link) || !jobIdFromHref(link.getAttribute('href'))) continue;
      const card = deriveCardFromLink(link);
      if (card && !nodeSet.has(card)) {
        nodeSet.add(card);
        cardNodes.push(card);
      }
    }
    return cardNodes;
  }

  function findTitleLink(card) {
    const explicit = firstVisible(card, TITLE_LINK_SELECTORS);
    if (explicit && canonicalJobUrl(explicit.getAttribute('href'))) return explicit;
    for (const link of card.querySelectorAll('a[href]')) {
      if (isVisible(link) && canonicalJobUrl(link.getAttribute('href'))) return link;
    }
    return null;
  }

  function commercialTextForCard(card, sourceNativeId) {
    let node = card;
    let bestText = cutJunkTail(card.textContent).slice(0, 18000);
    let bestScore = evidence.evidenceScore(bestText) * 40 + cueCount(bestText) * 4;

    for (let depth = 0; depth < 12 && node && node !== document.body; depth += 1) {
      if (isVisible(node)) {
        const ids = uniqueJobIds(node);
        const text = cutJunkTail(node.textContent).slice(0, 24000);
        if (ids.size === 1 && ids.has(sourceNativeId) && text.length >= 80) {
          const semanticBonus = node.matches('article, section, [data-test*="job" i], [class*="job" i]') ? 10 : 0;
          const score = evidence.evidenceScore(text) * 40 + cueCount(text) * 4 + semanticBonus - Math.max(0, text.length - 16000) / 600;
          if (score > bestScore) {
            bestText = text;
            bestScore = score;
          }
        }
      }
      node = node.parentElement;
    }
    return bestText;
  }

  function extractSkills(card) {
    const values = [];
    const seen = new Set();
    for (const selector of SKILL_SELECTORS) {
      for (const node of card.querySelectorAll(selector)) {
        if (!isVisible(node)) continue;
        const value = evidence.normalizeText(node.textContent);
        const key = value.toLowerCase();
        if (value.length > 1 && value.length <= 80 && !seen.has(key)) {
          seen.add(key);
          values.push(value);
        }
        if (values.length >= 20) return values;
      }
    }
    return values;
  }

  function extractDescription(card, title) {
    const candidates = [];
    const seen = new Set();
    for (const selector of DESCRIPTION_SELECTORS) {
      for (const node of card.querySelectorAll(selector)) {
        if (!isVisible(node)) continue;
        const value = cutJunkTail(node.textContent);
        const key = value.toLowerCase();
        if (value.length >= 80 && value.toLowerCase() !== title.toLowerCase() && !seen.has(key)) {
          seen.add(key);
          candidates.push(value);
        }
      }
    }
    candidates.sort((a, b) => b.length - a.length);
    return candidates[0] || "";
  }

  function inferredServiceLanes(title, description, skills) {
    const text = evidence.normalizeText(`${title} ${description} ${skills.join(" ")}`);
    const lanes = [];
    if (/\b(?:brand identity|logo design|logo mark|wordmark|brand guidelines|corporate identity|content writer|content writing|blog articles?|seo content|copywriting)\b/i.test(text)) {
      lanes.push("digital_growth");
    }
    if (/\b(?:video creator|video editor|video editing|ai video|animation|motion graphics|vfx|3d renders?|3d rendering|3d modeling|premiere pro|after effects)\b/i.test(text)) {
      lanes.push("creative_animation");
    }
    return lanes;
  }

  function extractCards(limit = 10) {
    const cards = [];
    const seenIds = new Set();
    for (const card of collectCandidateCards()) {
      if (!isVisible(card)) continue;
      const titleLink = findTitleLink(card);
      if (!titleLink) continue;
      const sourceUrl = canonicalJobUrl(titleLink.getAttribute('href'));
      const sourceNativeId = evidence.nativeIdFromUrl(sourceUrl || "");
      if (!sourceUrl || !sourceNativeId || seenIds.has(sourceNativeId)) continue;

      let title = evidence.normalizeText(titleLink.textContent);
      if (!title || title.length < 4) {
        const heading = firstVisible(card, ['h1', 'h2', 'h3', 'h4', '[role="heading"]']);
        title = evidence.normalizeText(heading ? heading.textContent : "");
      }

      const cardText = commercialTextForCard(card, sourceNativeId);
      if (!title || !cardText || cueCount(cardText) < 1) continue;
      const description = extractDescription(card, title);
      const skills = extractSkills(card);
      const commercialEvidence = evidence.parseCommercialEvidence(cardText);
      const serviceLanes = inferredServiceLanes(title, description || cardText, skills);
      if (serviceLanes.length) commercialEvidence.service_lanes = serviceLanes;

      seenIds.add(sourceNativeId);
      cards.push({
        source_url: sourceUrl,
        source_native_id: sourceNativeId,
        title,
        body: description || cardText,
        posted_age: commercialEvidence.posted_age || "",
        commercial_evidence: commercialEvidence,
        raw_evidence: {
          card_text: cardText,
          skills,
          visible_description: description,
          commercial_field_count: evidence.evidenceScore(cardText),
          stable_job_identity_used: true
        }
      });
      if (cards.length >= limit) break;
    }
    return cards;
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== "CODISTAN_CAPTURE_VISIBLE_UPWORK_CARDS") return false;
    try {
      const cards = extractCards(Number(message.limit) || 10);
      sendResponse({
        ok: true,
        page_url: window.location.href,
        page_title: document.title,
        active_saved_search_name: activeSavedSearchName(),
        visible_approved_search_names: visibleApprovedSearchNames(),
        cards,
        diagnostics: {
          job_links_detected: Array.from(document.querySelectorAll('a[href]'))
            .filter(link => isVisible(link) && jobIdFromHref(link.getAttribute('href'))).length,
          candidate_cards_detected: collectCandidateCards().length,
          commercial_fields_detected: cards.reduce((count, card) => count + Number(card.raw_evidence?.commercial_field_count || 0), 0)
        }
      });
    } catch (error) {
      sendResponse({ok: false, error: error instanceof Error ? error.message : String(error)});
    }
    return true;
  });
})();