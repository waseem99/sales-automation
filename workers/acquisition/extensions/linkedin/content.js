(() => {
  "use strict";

  const signal = globalThis.CodistanLinkedInSignal;
  if (!signal) return;

  const POST_SELECTORS = [
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
    '[data-test-id*="post-text"]'
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
    'time',
    '[data-test-id*="timestamp"]'
  ];
  const URN_ATTRIBUTES = [
    'data-urn',
    'data-id',
    'data-chameleon-result-urn',
    'data-view-tracking-scope',
    'data-activity-urn',
    'id'
  ];

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
    return signal.normalizeText(node?.innerText || node?.textContent || "");
  }

  function findOriginalRoot(post) {
    for (const selector of ORIGINAL_ROOT_SELECTORS) {
      const node = post.querySelector(selector);
      if (node && isVisible(node)) return node;
    }
    return post;
  }

  function activityUrn(root) {
    const inspected = [];
    const add = node => {
      if (node instanceof Element && !inspected.includes(node)) inspected.push(node);
    };
    add(root);
    add(root.closest?.('[data-urn], [data-id], [data-chameleon-result-urn], [data-view-tracking-scope], [data-activity-urn]'));
    for (const node of root.querySelectorAll('[data-urn], [data-id], [data-chameleon-result-urn], [data-view-tracking-scope], [data-activity-urn], [id]')) {
      add(node);
      if (inspected.length >= 150) break;
    }
    for (const node of inspected) {
      for (const attribute of URN_ATTRIBUTES) {
        const urn = signal.activityUrnFromValue(node.getAttribute?.(attribute));
        if (urn) return urn;
      }
    }
    for (const anchor of root.querySelectorAll('a[href]')) {
      const urn = signal.activityUrnFromValue(anchor.getAttribute('href'));
      if (urn) return urn;
    }
    return "";
  }

  function currentIndividualPostUrl() {
    try {
      const url = new URL(window.location.href);
      if (url.pathname.startsWith('/posts/') || url.pathname.startsWith('/feed/update/') || url.pathname.startsWith('/pulse/')) {
        return signal.canonicalPostUrl(url.href);
      }
    } catch (_error) {
      // Ignore malformed location values.
    }
    return "";
  }

  function postUrl(root, fallbackRoot) {
    const anchorSet = new Set([
      ...root.querySelectorAll('a[href]'),
      ...(root === fallbackRoot ? [] : fallbackRoot.querySelectorAll('a[href]'))
    ]);
    for (const anchor of anchorSet) {
      const href = anchor.getAttribute('href') || '';
      const value = signal.canonicalPostUrl(href, signal.activityUrnFromValue(href));
      if (value) return value;
    }
    const urn = activityUrn(root) || activityUrn(fallbackRoot);
    if (urn) return signal.canonicalPostUrl('', urn);
    return currentIndividualPostUrl();
  }

  function actor(root) {
    const link = firstVisible(root, ACTOR_LINK_SELECTORS);
    const name = textFrom(root, ACTOR_NAME_SELECTORS) || signal.normalizeText(link?.textContent || "");
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
          const value = signal.normalizeText(node.innerText || node.textContent || "");
          if (value.length >= 35) candidates.push(value);
        }
      }
      const fallback = signal.normalizeText(candidateRoot.innerText || candidateRoot.textContent || "");
      if (fallback.length >= 35 && fallback.length <= 12000) candidates.push(fallback);
    };
    collect(root);
    if (root !== fallbackRoot) collect(fallbackRoot);
    candidates.sort((a, b) => b.length - a.length);
    return candidates[0] || "";
  }

  function extractVisiblePosts(limit = 20) {
    const posts = [];
    const seenUrls = new Set();
    const nodes = [];
    const nodeSet = new Set();
    const diagnostics = {
      visible_post_containers: 0,
      posts_with_readable_text: 0,
      classified_candidates: 0,
      missing_canonical_url: 0,
      duplicate_urls: 0,
      rejection_reasons: {}
    };

    for (const selector of POST_SELECTORS) {
      for (const node of document.querySelectorAll(selector)) {
        if (!nodeSet.has(node) && isVisible(node)) {
          nodeSet.add(node);
          nodes.push(node);
        }
      }
    }
    diagnostics.visible_post_containers = nodes.length;

    for (const post of nodes) {
      const originalRoot = findOriginalRoot(post);
      const body = visibleBody(originalRoot, post);
      if (!body) continue;
      diagnostics.posts_with_readable_text += 1;
      const classification = signal.classifyOpportunity(body);
      if (!classification.candidate) {
        const reason = classification.reject_reason || 'unknown_rejection';
        diagnostics.rejection_reasons[reason] = Number(diagnostics.rejection_reasons[reason] || 0) + 1;
        continue;
      }
      diagnostics.classified_candidates += 1;
      const sourceUrl = postUrl(originalRoot, post);
      if (!sourceUrl) {
        diagnostics.missing_canonical_url += 1;
        continue;
      }
      if (seenUrls.has(sourceUrl)) {
        diagnostics.duplicate_urls += 1;
        continue;
      }
      const originalAuthor = actor(originalRoot);
      const reposter = originalRoot === post ? null : actor(post);
      const urn = signal.activityUrnFromValue(sourceUrl) || activityUrn(originalRoot) || activityUrn(post);
      const postedAge = textFrom(originalRoot, TIME_SELECTORS) || textFrom(post, TIME_SELECTORS);
      const title = body.length > 140 ? `${body.slice(0, 137)}...` : body;
      seenUrls.add(sourceUrl);
      posts.push({
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
          classifier_version: "linkedin-direct-requirement-1.0.1",
          extraction_version: "linkedin-dom-1.0.1"
        }
      });
      if (posts.length >= limit) break;
    }
    return {records: posts, diagnostics};
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
        diagnostics: {
          ...extracted.diagnostics,
          candidate_posts: extracted.records.length
        }
      });
    } catch (error) {
      sendResponse({ok: false, error: error instanceof Error ? error.message : String(error)});
    }
    return true;
  });
})();
