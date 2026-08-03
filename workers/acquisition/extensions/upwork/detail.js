(() => {
  "use strict";

  const evidence = globalThis.CodistanUpworkEvidence;
  if (!evidence) return;

  function visible(node) {
    if (!(node instanceof Element)) return false;
    const rect = node.getBoundingClientRect();
    const style = window.getComputedStyle(node);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
  }

  function firstText(selectors, minimum = 1) {
    for (const selector of selectors) {
      for (const node of document.querySelectorAll(selector)) {
        if (!visible(node)) continue;
        const value = evidence.normalizeText(node.textContent);
        if (value.length >= minimum) return value;
      }
    }
    return "";
  }

  function allText(selectors, limit = 30) {
    const values = [];
    const seen = new Set();
    for (const selector of selectors) {
      for (const node of document.querySelectorAll(selector)) {
        if (!visible(node)) continue;
        const value = evidence.normalizeText(node.textContent);
        const key = value.toLowerCase();
        if (value && !seen.has(key)) {
          seen.add(key);
          values.push(value);
        }
        if (values.length >= limit) return values;
      }
    }
    return values;
  }

  function canonicalUrl() {
    const url = new URL(location.href);
    url.search = "";
    url.hash = "";
    return `https://www.upwork.com${url.pathname.replace(/\/$/, "")}`;
  }

  function extractDetail() {
    const pageText = evidence.normalizeText(document.body?.innerText || "").slice(0, 60000);
    const title = firstText([
      'h1[data-test*="job-title"]',
      '[data-test="job-title"]',
      'h1',
      '[role="heading"][aria-level="1"]'
    ], 4);
    const body = firstText([
      '[data-test="Description"]',
      '[data-test*="description"]',
      '[data-test*="job-description"]',
      'section[data-test*="description"]',
      'article',
      'main'
    ], 80).slice(0, 18000);
    const skills = allText([
      '[data-test*="skill"]',
      'a[href*="ontology_skill"]',
      '[class*="skill"] [class*="token"]',
      '[class*="skills"] a'
    ], 30);
    const commercialEvidence = evidence.parseCommercialEvidence(pageText);
    const clientLocation = firstText([
      '[data-test*="location"]',
      '[data-qa*="location"]',
      '[class*="location"]'
    ], 2);

    return {
      source_url: canonicalUrl(),
      source_native_id: evidence.nativeIdFromUrl(location.href),
      title,
      body: body || pageText.slice(0, 12000),
      posted_age: commercialEvidence.posted_age || "",
      commercial_evidence: commercialEvidence,
      raw_evidence: {
        skills,
        location: clientLocation,
        detail_page_text: pageText,
        detail_enrichment: true,
        stable_job_identity_used: true
      }
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== "CODISTAN_CAPTURE_UPWORK_JOB_DETAIL") return false;
    try {
      const record = extractDetail();
      if (!record.source_native_id || !record.title || !record.body) {
        throw new Error("The Upwork job detail page did not expose stable job evidence.");
      }
      sendResponse({
        ok: true,
        page_url: location.href,
        page_title: document.title,
        record
      });
    } catch (error) {
      sendResponse({ok: false, error: error instanceof Error ? error.message : String(error)});
    }
    return true;
  });
})();
