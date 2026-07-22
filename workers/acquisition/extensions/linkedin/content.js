(() => {
  "use strict";

  const signal = globalThis.CodistanLinkedInSignal;
  if (!signal) return;

  const POST_SELECTORS = [
    'div.feed-shared-update-v2',
    'div.occludable-update',
    'div[data-urn*="urn:li:activity:"]',
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
    '.update-components-text',
    '.feed-shared-update-v2__description',
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
    return signal.normalizeText(node?.textContent || "");
  }

  function findOriginalRoot(post) {
    for (const selector of ORIGINAL_ROOT_SELECTORS) {
      const node = post.querySelector(selector);
      if (node && isVisible(node)) return node;
    }
    return post;
  }

  function activityUrn(root) {
    const candidates = [
      root.getAttribute?.("data-urn"),
      root.dataset?.urn,
      root.querySelector?.('[data-urn*="urn:li:activity:"]')?.getAttribute("data-urn")
    ];
    for (const value of candidates) {
      const urn = signal.activityUrnFromValue(value);
      if (urn) return urn;
    }
    return "";
  }

  function postUrl(root, fallbackRoot) {
    const anchors = [
      ...root.querySelectorAll('a[href*="/posts/"]'),
      ...root.querySelectorAll('a[href*="/feed/update/urn:li:activity:"]'),
      ...root.querySelectorAll('a[href*="/pulse/"]')
    ];
    for (const anchor of anchors) {
      if (!isVisible(anchor)) continue;
      const value = signal.canonicalPostUrl(anchor.getAttribute("href"), activityUrn(root));
      if (value) return value;
    }
    const urn = activityUrn(root) || activityUrn(fallbackRoot);
    return signal.canonicalPostUrl("", urn);
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
    for (const selector of BODY_SELECTORS) {
      for (const node of root.querySelectorAll(selector)) {
        if (!isVisible(node)) continue;
        const value = signal.normalizeText(node.textContent);
        if (value.length >= 40) candidates.push(value);
      }
    }
    if (!candidates.length && root !== fallbackRoot) {
      for (const selector of BODY_SELECTORS) {
        for (const node of fallbackRoot.querySelectorAll(selector)) {
          if (!isVisible(node)) continue;
          const value = signal.normalizeText(node.textContent);
          if (value.length >= 40) candidates.push(value);
        }
      }
    }
    candidates.sort((a, b) => b.length - a.length);
    return candidates[0] || "";
  }

  function extractVisiblePosts(limit = 20) {
    const posts = [];
    const seenUrls = new Set();
    const nodes = [];
    const nodeSet = new Set();
    for (const selector of POST_SELECTORS) {
      for (const node of document.querySelectorAll(selector)) {
        if (!nodeSet.has(node) && isVisible(node)) {
          nodeSet.add(node);
          nodes.push(node);
        }
      }
    }

    for (const post of nodes) {
      const originalRoot = findOriginalRoot(post);
      const body = visibleBody(originalRoot, post);
      if (!body) continue;
      const classification = signal.classifyOpportunity(body);
      if (!classification.candidate) continue;
      const sourceUrl = postUrl(originalRoot, post);
      if (!sourceUrl || seenUrls.has(sourceUrl)) continue;
      const originalAuthor = actor(originalRoot);
      const reposter = originalRoot === post ? null : actor(post);
      const urn = signal.activityUrnFromValue(sourceUrl) || activityUrn(originalRoot) || activityUrn(post);
      const postedAge = textFrom(originalRoot, TIME_SELECTORS) || textFrom(post, TIME_SELECTORS);
      const title = body.length > 140 ? `${body.slice(0, 137)}...` : body;
      seenUrls.add(sourceUrl);
      posts.push({
        source_url: sourceUrl,
        source_native_id: urn,
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
          classifier_version: "linkedin-direct-requirement-1.0.0"
        }
      });
      if (posts.length >= limit) break;
    }
    return posts;
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== "CODISTAN_CAPTURE_VISIBLE_LINKEDIN_POSTS") return false;
    try {
      const records = extractVisiblePosts(Number(message.limit) || 20);
      sendResponse({
        ok: true,
        page_url: window.location.href,
        page_title: document.title,
        records,
        diagnostics: {
          visible_post_containers: document.querySelectorAll(POST_SELECTORS.join(",")).length,
          candidate_posts: records.length
        }
      });
    } catch (error) {
      sendResponse({ok: false, error: error instanceof Error ? error.message : String(error)});
    }
    return true;
  });
})();
