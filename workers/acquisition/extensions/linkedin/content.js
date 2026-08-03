(() => {
  "use strict";

  const signal = globalThis.CodistanLinkedInSignal;
  const hardening = globalThis.CodistanLinkedInParserHardening;
  if (!signal || !hardening) return;

  const PARSER_VERSION = "linkedin-dom-1.2.0";
  const monitor = hardening.createDomMonitor(document);
  const POST_SELECTORS = [
    '[data-codistan-opportunity-card="true"]',
    'div[data-view-name="feed-full-update"]',
    'div.feed-shared-update-v2',
    'div.occludable-update',
    'div[data-urn*="urn:li:activity:"]',
    'div[data-id*="urn:li:activity:"]',
    '[data-chameleon-result-urn*="urn:li:activity:"]',
    'li.reusable-search__result-container',
    'article'
  ];
  const ORIGINAL_ROOT_SELECTORS = [
    '.feed-shared-update-v2__reshared-content',
    '.update-components-mini-update-v2',
    '[data-reshared-update]',
    '.feed-shared-article__description-container'
  ];
  const BODY_SELECTORS = [
    '[data-view-name="feed-commentary"]',
    '.update-components-text',
    '.feed-shared-update-v2__description',
    '.feed-shared-inline-show-more-text',
    '.feed-shared-text',
    '.entity-result__summary',
    '.break-words',
    '[data-test-id*="post-text"]',
    '[class*="document"] [class*="description"]',
    '[class*="carousel"] [class*="description"]'
  ];
  const ACTOR_NAME_SELECTORS = [
    '.update-components-actor__name',
    '.feed-shared-actor__name',
    '.entity-result__title-text',
    '[data-test-id*="actor-name"]'
  ];
  const ACTOR_LINK_SELECTORS = [
    '.update-components-actor__meta-link',
    '.feed-shared-actor__container-link',
    'a[href*="/in/"]',
    'a[href*="/company/"]'
  ];
  const HEADLINE_SELECTORS = [
    '.update-components-actor__description',
    '.feed-shared-actor__description',
    '.entity-result__primary-subtitle',
    '[data-test-id*="actor-description"]'
  ];
  const TIME_SELECTORS = [
    '.update-components-actor__sub-description',
    '.feed-shared-actor__sub-description',
    'a[href*="/feed/update/"]',
    'a[href*="/posts/"]',
    'time',
    '[data-test-id*="timestamp"]'
  ];
  const AGE_TEXT = /^(?:\d+\s*(?:m|h|d|w|mo|yr)s?|just now)(?:\s*•.*)?$/i;

  function isVisible(element) {
    if (!(element instanceof Element)) return false;
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  }

  function firstVisible(root, selectors) {
    for (const selector of selectors) {
      const node = root.querySelector(selector);
      if (node && isVisible(node)) return node;
    }
    return null;
  }

  function textFrom(root, selectors) {
    const node = firstVisible(root, selectors);
    return hardening.normalizeText(node?.innerText || node?.textContent || "", 20000);
  }

  function findOriginalRoot(post) {
    for (const selector of ORIGINAL_ROOT_SELECTORS) {
      const node = post.querySelector(selector);
      if (node && isVisible(node)) return node;
    }
    return post;
  }

  function decodedVariants(value) {
    const values = new Set([String(value || "")]);
    let current = String(value || "");
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const decoded = decodeURIComponent(current);
        if (!decoded || decoded === current) break;
        values.add(decoded);
        current = decoded;
      } catch (_error) {
        break;
      }
    }
    return [...values];
  }

  function looseActivityUrn(value) {
    for (const variant of decodedVariants(value)) {
      const direct = signal.activityUrnFromValue(variant);
      if (direct) return direct;
      const match = /(?:activity[-_:]|activity%3a)(\d{12,})/i.exec(variant);
      if (match) return `urn:li:activity:${match[1]}`;
    }
    return "";
  }

  function canonicalFromValue(value) {
    for (const variant of decodedVariants(value)) {
      const canonical = signal.canonicalPostUrl(variant, looseActivityUrn(variant));
      if (canonical) return hardening.canonicalPostUrl(canonical);
    }
    return "";
  }

  function nodeAttributeValues(root, limit = 500) {
    const values = [];
    const nodes = [];
    if (root instanceof Element) nodes.push(root);
    for (const node of root.querySelectorAll("*")) {
      nodes.push(node);
      if (nodes.length >= limit) break;
    }
    for (const node of nodes) {
      for (const attribute of node.attributes || []) {
        const value = String(attribute.value || "");
        if (value) values.push(value);
      }
    }
    return values;
  }

  function currentIndividualPostUrl() {
    return hardening.canonicalPostUrl(window.location.href);
  }

  function activityUrn(root) {
    if (!(root instanceof Element)) return "";
    for (const value of nodeAttributeValues(root)) {
      const urn = looseActivityUrn(value);
      if (urn) return urn;
    }
    return looseActivityUrn(String(root.outerHTML || "").slice(0, 600000));
  }

  function candidateScopes(post) {
    const scopes = [];
    let node = post;
    for (let depth = 0; node instanceof Element && depth < 5; depth += 1, node = node.parentElement) {
      if (!scopes.includes(node)) scopes.push(node);
      if (node.matches('main, [role="main"]')) break;
    }
    return scopes;
  }

  function timestampCandidate(root) {
    for (const scope of candidateScopes(root)) {
      for (const anchor of scope.querySelectorAll("a[href]")) {
        const href = String(anchor.href || anchor.getAttribute("href") || "");
        const canonical = canonicalFromValue(href);
        if (canonical) return canonical;
        const text = hardening.normalizeText(anchor.innerText || anchor.textContent || "", 120);
        const label = hardening.normalizeText(anchor.getAttribute("aria-label") || anchor.getAttribute("title") || "", 200);
        if ((AGE_TEXT.test(text) || /\b(?:ago|post)\b/i.test(label)) && href) {
          const indirect = canonicalFromValue(href);
          if (indirect) return indirect;
        }
      }
    }
    return "";
  }

  function postUrl(root, fallbackRoot, knownUrn = "") {
    const individual = currentIndividualPostUrl();
    if (individual) return individual;
    for (const scope of candidateScopes(root)) {
      for (const value of nodeAttributeValues(scope)) {
        const canonical = canonicalFromValue(value);
        if (canonical) return canonical;
      }
      const timestamp = timestampCandidate(scope);
      if (timestamp) return timestamp;
    }
    if (fallbackRoot !== root) {
      const fallbackTimestamp = timestampCandidate(fallbackRoot);
      if (fallbackTimestamp) return fallbackTimestamp;
    }
    const urn = knownUrn || activityUrn(root) || activityUrn(fallbackRoot);
    return urn ? hardening.canonicalPostUrl(signal.canonicalPostUrl("", urn)) : "";
  }

  function actor(root) {
    const link = firstVisible(root, ACTOR_LINK_SELECTORS);
    const name = textFrom(root, ACTOR_NAME_SELECTORS) || hardening.normalizeText(link?.textContent || "", 300);
    let profileUrl = "";
    try {
      if (link?.href) {
        const url = new URL(link.href, "https://www.linkedin.com");
        if (["linkedin.com", "www.linkedin.com"].includes(url.hostname)) {
          profileUrl = `https://www.linkedin.com${url.pathname.replace(/\/$/, "")}`;
        }
      }
    } catch (_error) {
      profileUrl = "";
    }
    return {
      name: name.slice(0, 300),
      profile_url: profileUrl,
      headline: textFrom(root, HEADLINE_SELECTORS).slice(0, 500),
      company: ""
    };
  }

  function visibleBody(root, fallbackRoot) {
    const candidates = [];
    const collect = candidateRoot => {
      for (const selector of BODY_SELECTORS) {
        for (const node of candidateRoot.querySelectorAll(selector)) {
          if (!isVisible(node)) continue;
          const value = hardening.normalizeText(node.innerText || node.textContent || "", 20000);
          if (value.length >= 35) candidates.push(value);
        }
      }
      const fallback = hardening.normalizeText(candidateRoot.innerText || candidateRoot.textContent || "", 20000);
      if (fallback.length >= 35 && fallback.length <= 15000) candidates.push(fallback);
    };
    collect(root);
    if (root !== fallbackRoot) collect(fallbackRoot);
    candidates.sort((a, b) => b.length - a.length);
    return candidates[0] || "";
  }

  function visiblePostNodes() {
    const nodes = [];
    const seen = new Set();
    for (const selector of POST_SELECTORS) {
      for (const node of document.querySelectorAll(selector)) {
        if (seen.has(node) || !isVisible(node)) continue;
        seen.add(node);
        nodes.push(node);
      }
    }
    return nodes;
  }

  function increment(map, key) {
    map[key] = Number(map[key] || 0) + 1;
  }

  function extractVisiblePosts(limit = 20) {
    const posts = [];
    const candidateUrls = [];
    const seenUrls = new Set();
    const diagnostics = {
      parser_version: PARSER_VERSION,
      hardening_version: hardening.VERSION,
      visible_post_containers: 0,
      adapter_marked_containers: 0,
      posts_with_readable_text: 0,
      classified_candidates: 0,
      candidate_urls: 0,
      containers_with_activity_id: 0,
      containers_with_permalink_hint: 0,
      missing_canonical_url: 0,
      partial_parse_rejections: 0,
      duplicate_urls: 0,
      rejection_reasons: {},
      layout_signature: hardening.layoutSignature(document, {posts: POST_SELECTORS, bodies: BODY_SELECTORS, actors: ACTOR_NAME_SELECTORS}),
      dom_mutations: monitor.snapshot()
    };

    const nodes = visiblePostNodes();
    diagnostics.visible_post_containers = nodes.length;
    diagnostics.adapter_marked_containers = document.querySelectorAll('[data-codistan-opportunity-card="true"]').length;

    for (const post of nodes) {
      const originalRoot = findOriginalRoot(post);
      const body = visibleBody(originalRoot, post);
      if (!body) {
        increment(diagnostics.rejection_reasons, "missing_readable_body");
        continue;
      }
      diagnostics.posts_with_readable_text += 1;
      const classification = signal.classifyOpportunity(body);
      if (!classification.candidate) {
        increment(diagnostics.rejection_reasons, classification.reject_reason || "unknown_rejection");
        continue;
      }
      diagnostics.classified_candidates += 1;
      const knownUrn = activityUrn(originalRoot) || activityUrn(post);
      if (knownUrn) diagnostics.containers_with_activity_id += 1;
      const sourceUrl = postUrl(originalRoot, post, knownUrn);
      if (!sourceUrl) {
        diagnostics.missing_canonical_url += 1;
        increment(diagnostics.rejection_reasons, "missing_canonical_url");
        continue;
      }
      diagnostics.containers_with_permalink_hint += 1;
      if (!candidateUrls.includes(sourceUrl)) candidateUrls.push(sourceUrl);
      if (seenUrls.has(sourceUrl)) {
        diagnostics.duplicate_urls += 1;
        continue;
      }

      const originalAuthor = actor(originalRoot);
      const reposter = originalRoot === post ? null : actor(post);
      const urn = looseActivityUrn(sourceUrl) || knownUrn;
      const postedAge = textFrom(originalRoot, TIME_SELECTORS) || textFrom(post, TIME_SELECTORS);
      const age = hardening.localizedAge(postedAge);
      const title = body.length > 140 ? `${body.slice(0, 137)}...` : body;
      const record = {
        source_url: sourceUrl,
        source_native_id: urn || sourceUrl,
        title,
        body,
        author: originalAuthor,
        posted_age: postedAge.slice(0, 100),
        commercial_evidence: {
          signal_type: classification.signal_type,
          service_lanes: classification.service_lanes,
          intent_phrases: classification.intent_phrases,
          contact_routes: classification.contact_routes
        },
        raw_evidence: {
          original_author_name: originalAuthor.name,
          original_author_profile_url: originalAuthor.profile_url,
          reposter_name: reposter?.name || "",
          reposter_profile_url: reposter?.profile_url || "",
          is_repost: Boolean(reposter),
          localized_post_age: age,
          classifier_version: "linkedin-direct-requirement-1.0.1",
          extraction_version: PARSER_VERSION,
          parser_hardening_version: hardening.VERSION,
          parser_status: "pending"
        }
      };
      const assessment = hardening.evaluateLinkedInRecord(record);
      record.raw_evidence.parser_status = assessment.status;
      record.raw_evidence.parser_diagnostics = assessment;
      if (assessment.status !== "complete") {
        diagnostics.partial_parse_rejections += 1;
        for (const field of assessment.missing_critical_fields) increment(diagnostics.rejection_reasons, `missing_${field}`);
        continue;
      }
      seenUrls.add(sourceUrl);
      posts.push(record);
      if (currentIndividualPostUrl() && posts.length >= 1) break;
      if (posts.length >= limit) break;
    }

    const deduped = hardening.dedupeRecords(posts);
    diagnostics.duplicate_urls += deduped.duplicates;
    diagnostics.candidate_urls = candidateUrls.length;
    diagnostics.dom_mutations = monitor.snapshot();
    return {
      records: deduped.records,
      candidate_urls: candidateUrls.slice(0, limit),
      diagnostics: hardening.sanitize(diagnostics)
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== "CODISTAN_CAPTURE_VISIBLE_LINKEDIN_POSTS") return false;
    try {
      const extracted = extractVisiblePosts(Number(message.limit) || 20);
      sendResponse({
        ok: true,
        page_url: window.location.href,
        page_title: document.title,
        records: extracted.records,
        candidate_urls: extracted.candidate_urls,
        diagnostics: {
          ...extracted.diagnostics,
          candidate_posts: extracted.records.length
        }
      });
    } catch (error) {
      sendResponse({ok: false, error: hardening.safeError(error), parser_version: PARSER_VERSION});
    }
    return true;
  });
})();
