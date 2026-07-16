(() => {
  "use strict";

  const CARD_SELECTORS = [
    'article[data-test="JobTile"]',
    'section[data-test="job-tile"]',
    '[data-test="job-tile-list"] article',
    'article.job-tile',
    '[data-test="job-tile"]'
  ];

  const TITLE_LINK_SELECTORS = [
    'a[data-test="job-tile-title-link"]',
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
    'p'
  ];

  const SKILL_SELECTORS = [
    '[data-test="TokenClamp"] a',
    '[data-test="Skill"]',
    'a[href*="ontology_skill"]',
    'button[data-test*="skill"]'
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

  function extractCards(limit = 10) {
    const cardNodes = [];
    const nodeSet = new Set();
    for (const selector of CARD_SELECTORS) {
      for (const node of document.querySelectorAll(selector)) {
        if (!nodeSet.has(node)) {
          nodeSet.add(node);
          cardNodes.push(node);
        }
      }
    }

    const cards = [];
    const seenUrls = new Set();
    for (const card of cardNodes) {
      if (!isVisible(card)) continue;
      const titleLink = firstMatch(card, TITLE_LINK_SELECTORS);
      if (!titleLink) continue;
      const sourceUrl = canonicalJobUrl(titleLink.getAttribute('href'));
      if (!sourceUrl || seenUrls.has(sourceUrl)) continue;

      const title = normalizeText(titleLink.textContent);
      const descriptionNode = firstMatch(card, DESCRIPTION_SELECTORS);
      const description = normalizeText(descriptionNode ? descriptionNode.textContent : "");
      const cardText = normalizeText(card.textContent).slice(0, 12000);
      if (!title || !cardText) continue;

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
      sendResponse({
        ok: true,
        page_url: window.location.href,
        page_title: document.title,
        cards: extractCards(Number(message.limit) || 10)
      });
    } catch (error) {
      sendResponse({ok: false, error: error instanceof Error ? error.message : String(error)});
    }
    return true;
  });
})();
