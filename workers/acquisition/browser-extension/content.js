(() => {
  "use strict";

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
    'a[href*="/jobs/"]',
    'a[href*="/freelance-jobs/apply/"]',
    'h2 a',
    'h3 a'
  ];

  const DESCRIPTION_SELECTORS = [
    '[data-test="UpCLineClamp JobDescription"]',
    '[data-test="job-description"]',
    '[data-test="job-description-text"]',
    '[data-test*="description"]',
    '[class*="description"]',
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
    'posted ',
    'proposal',
    'payment verified',
    'est. budget',
    'hourly',
    'fixed-price',
    'spent',
    'intermediate',
    'expert',
    'entry level'
  ];

  function isVisible(element) {
    if (!(element instanceof Element)) return false;
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  }

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function firstMatch(root, selectors) {
    for (const selector of selectors) {
      const node = root.querySelector(selector);
      if (node && isVisible(node)) return node;
    }
    return null;
  }

  function canonicalJobUrl(href) {
    try {
      const url = new URL(href, "https://www.upwork.com");
      if (!['upwork.com', 'www.upwork.com'].includes(url.hostname)) return null;
      if (!url.pathname.includes('/jobs/') && !url.pathname.includes('/freelance-jobs/apply/')) return null;
      return `https://www.upwork.com${url.pathname}`;
    } catch (_error) {
      return null;
    }
  }

  function extractSkills(card) {
    const values = [];
    const seen = new Set();
    for (const selector of SKILL_SELECTORS) {
      for (const node of card.querySelectorAll(selector)) {
        if (!isVisible(node)) continue;
        const value = normalizeText(node.textContent);
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

  function cueCount(text) {
    const lowered = text.toLowerCase();
    return JOB_CARD_CUES.reduce((count, cue) => count + (lowered.includes(cue) ? 1 : 0), 0);
  }

  function deriveCardFromLink(link) {
    let node = link;
    let best = null;
    for (let depth = 0; depth < 10 && node && node !== document.body; depth += 1) {
      node = node.parentElement;
      if (!node || !isVisible(node)) continue;
      const text = normalizeText(node.textContent);
      if (text.length < 80 || text.length > 15000) continue;
      const cues = cueCount(text);
      const hasSingleJobLink = Array.from(node.querySelectorAll('a[href]'))
        .map(anchor => canonicalJobUrl(anchor.getAttribute('href')))
        .filter(Boolean).length <= 3;
      if (cues >= 2 && hasSingleJobLink) {
        best = node;
        if (node.matches('article, section, [data-test*="job" i], [class*="job" i]')) break;
      }
    }
    return best;
  }

  function collectCandidateCards() {
    const cardNodes = [];
    const nodeSet = new Set();

    for (const selector of CARD_SELECTORS) {
      for (const node of document.querySelectorAll(selector)) {
        if (!nodeSet.has(node) && isVisible(node)) {
          nodeSet.add(node);
          cardNodes.push(node);
        }
      }
    }

    for (const link of document.querySelectorAll('a[href]')) {
      if (!isVisible(link) || !canonicalJobUrl(link.getAttribute('href'))) continue;
      const card = deriveCardFromLink(link);
      if (card && !nodeSet.has(card)) {
        nodeSet.add(card);
        cardNodes.push(card);
      }
    }

    return cardNodes;
  }

  function findTitleLink(card) {
    const explicit = firstMatch(card, TITLE_LINK_SELECTORS);
    if (explicit && canonicalJobUrl(explicit.getAttribute('href'))) return explicit;
    for (const link of card.querySelectorAll('a[href]')) {
      if (isVisible(link) && canonicalJobUrl(link.getAttribute('href'))) return link;
    }
    return null;
  }

  function extractCards(limit = 10) {
    const cardNodes = collectCandidateCards();
    const cards = [];
    const seenUrls = new Set();

    for (const card of cardNodes) {
      if (!isVisible(card)) continue;
      const titleLink = findTitleLink(card);
      if (!titleLink) continue;
      const sourceUrl = canonicalJobUrl(titleLink.getAttribute('href'));
      if (!sourceUrl || seenUrls.has(sourceUrl)) continue;

      let title = normalizeText(titleLink.textContent);
      if (!title || title.length < 4) {
        const heading = firstMatch(card, ['h1', 'h2', 'h3', 'h4', '[role="heading"]']);
        title = normalizeText(heading ? heading.textContent : '');
      }
      const descriptionNode = firstMatch(card, DESCRIPTION_SELECTORS);
      const description = normalizeText(descriptionNode ? descriptionNode.textContent : "");
      const cardText = normalizeText(card.textContent).slice(0, 12000);
      if (!title || !cardText || cueCount(cardText) < 1) continue;

      seenUrls.add(sourceUrl);
      cards.push({
        source_url: sourceUrl,
        title,
        description,
        card_text: cardText,
        skills: extractSkills(card)
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
        cards,
        diagnostics: {
          job_links_detected: Array.from(document.querySelectorAll('a[href]'))
            .filter(link => isVisible(link) && canonicalJobUrl(link.getAttribute('href'))).length,
          candidate_cards_detected: collectCandidateCards().length
        }
      });
    } catch (error) {
      sendResponse({ok: false, error: error instanceof Error ? error.message : String(error)});
    }
    return true;
  });
})();
