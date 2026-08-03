(() => {
  "use strict";

  const VERSION = "linkedin-parser-hardening-1.0.0";
  const MAX_DIAGNOSTIC_STRING = 400;
  const MAX_DIAGNOSTIC_ARRAY = 30;
  const MAX_DIAGNOSTIC_KEYS = 60;
  const SENSITIVE_KEY = /(?:cookie|authorization|csrf|xsrf|session|credential|password|passwd|secret|access[_-]?token|refresh[_-]?token|private[_-]?message|inmail[_-]?body)/i;
  const SENSITIVE_VALUE = /(?:bearer\s+[a-z0-9._~+/=-]{12,}|li_at=[^;\s]+|jsessionid=[^;\s]+|csrf[-_]?token\s*[:=]\s*[^\s,;]+)/ig;

  function normalizeText(value, limit = 20000) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, Math.max(0, Number(limit) || 0));
  }

  function redactString(value) {
    return normalizeText(value, MAX_DIAGNOSTIC_STRING).replace(SENSITIVE_VALUE, "[redacted]");
  }

  function sanitize(value, depth = 0, seen = new WeakSet()) {
    if (value == null || typeof value === "boolean" || typeof value === "number") return value;
    if (typeof value === "string") return redactString(value);
    if (typeof value !== "object") return redactString(String(value));
    if (depth >= 4) return "[bounded]";
    if (seen.has(value)) return "[circular]";
    seen.add(value);
    if (Array.isArray(value)) {
      return value.slice(0, MAX_DIAGNOSTIC_ARRAY).map(item => sanitize(item, depth + 1, seen));
    }
    const output = {};
    for (const [key, item] of Object.entries(value).slice(0, MAX_DIAGNOSTIC_KEYS)) {
      output[key] = SENSITIVE_KEY.test(key) ? "[redacted]" : sanitize(item, depth + 1, seen);
    }
    return output;
  }

  function safeError(error) {
    const name = error && typeof error === "object" && "name" in error ? String(error.name || "Error") : "Error";
    const message = error && typeof error === "object" && "message" in error ? String(error.message || "") : String(error || "");
    return `${redactString(name)}: ${redactString(message)}`.slice(0, MAX_DIAGNOSTIC_STRING);
  }

  function canonicalUrl(value, allowedPaths) {
    try {
      const url = new URL(String(value || ""), "https://www.linkedin.com");
      if (!["linkedin.com", "www.linkedin.com", "sales.linkedin.com"].includes(url.hostname.toLowerCase())) return "";
      if (!allowedPaths.some(prefix => url.pathname.toLowerCase().startsWith(prefix))) return "";
      url.protocol = "https:";
      url.hostname = "www.linkedin.com";
      url.search = "";
      url.hash = "";
      return url.toString().replace(/\/$/, "");
    } catch (_error) {
      return "";
    }
  }

  function canonicalPostUrl(value) {
    return canonicalUrl(value, ["/posts/", "/feed/update/", "/pulse/"]);
  }

  function canonicalLeadUrl(value) {
    return canonicalUrl(value, ["/sales/lead/", "/in/"]);
  }

  function recordAssessment(kind, record) {
    const missing = [];
    const warnings = [];
    const body = normalizeText(record?.body, 20000);
    const title = normalizeText(record?.title, 500);
    const author = record?.author && typeof record.author === "object" ? record.author : {};
    const sourceUrl = kind === "linkedin_post"
      ? canonicalPostUrl(record?.source_url)
      : canonicalLeadUrl(record?.source_url);

    if (!sourceUrl) missing.push("canonical_source_url");
    if (!title) missing.push("title");
    if (!body || body.length < 20) missing.push("readable_body");
    if (!normalizeText(author.name, 300)) missing.push("author_or_prospect_name");

    if (kind === "sales_navigator") {
      const headline = normalizeText(author.headline, 500);
      const company = normalizeText(author.company, 300);
      if (!headline && !company) missing.push("headline_or_company");
    }

    if (body.length > 15000) warnings.push("body_truncated_to_safe_limit");
    const status = missing.length === 0 ? "complete" : "reject";
    return Object.freeze({
      version: VERSION,
      kind,
      status,
      missing_critical_fields: missing,
      warnings,
      safe_for_actionable_qualification: status === "complete",
      canonical_source_url: sourceUrl,
      human_review_required: true,
      external_action_automated: false
    });
  }

  function evaluateLinkedInRecord(record) {
    return recordAssessment("linkedin_post", record);
  }

  function evaluateSalesNavigatorRecord(record) {
    return recordAssessment("sales_navigator", record);
  }

  function stableKey(record) {
    const url = canonicalPostUrl(record?.source_url) || canonicalLeadUrl(record?.source_url);
    return url || normalizeText(record?.source_native_id, 1000) || `${normalizeText(record?.title, 300)}|${normalizeText(record?.author?.name, 200)}`;
  }

  function dedupeRecords(records) {
    const output = [];
    const seen = new Set();
    let duplicates = 0;
    for (const record of Array.isArray(records) ? records : []) {
      const key = stableKey(record);
      if (!key || seen.has(key)) {
        duplicates += 1;
        continue;
      }
      seen.add(key);
      output.push(record);
    }
    return {records: output, duplicates, unique_keys: seen.size};
  }

  function localizedAge(value) {
    const text = normalizeText(value, 120).toLowerCase();
    if (!text) return {status: "unknown", normalized: ""};
    if (/\b(?:just now|now|today|heute|hoy|aujourd'hui|oggi)\b/.test(text)) return {status: "current", normalized: "today"};
    if (/\b(?:yesterday|gestern|ayer|hier|ieri)\b/.test(text)) return {status: "current", normalized: "1d"};
    if (/\d+\s*(?:m|min|mins|minute|minutes|minuten|minutos|分钟|دقيقة|دقائق)\b/.test(text)) return {status: "current", normalized: "minutes"};
    if (/\d+\s*(?:h|hr|hrs|hour|hours|std|stunde|stunden|heure|heures|hora|horas|小时|ساعة|ساعات)\b/.test(text)) return {status: "current", normalized: "hours"};
    const days = /(?:^|\s)(\d+)\s*(?:d|day|days|tag|tage|tagen|jour|jours|día|días|giorno|giorni|天|يوم|أيام)\b/.exec(text);
    if (days) return {status: Number(days[1]) <= 7 ? "current" : "stale", normalized: `${Number(days[1])}d`};
    if (/\d+\s*(?:w|week|weeks|woche|wochen|semaine|semaines|semana|semanas|settimana|settimane|周|أسبوع|أسابيع)\b/.test(text)) return {status: "stale", normalized: "weeks"};
    if (/\d+\s*(?:mo|month|months|monat|monate|mois|mes|meses|mese|mesi|月|شهر|أشهر|yr|year|years|jahr|jahre|an|ans|año|años|anno|anni|年|سنة|سنوات)\b/.test(text)) return {status: "stale", normalized: "older"};
    return {status: "unknown", normalized: text};
  }

  function layoutSignature(root, selectorGroups) {
    const counts = {};
    for (const [name, selectors] of Object.entries(selectorGroups || {})) {
      let count = 0;
      for (const selector of Array.isArray(selectors) ? selectors : []) {
        try {
          count += Number(root?.querySelectorAll?.(selector)?.length || 0);
        } catch (_error) {
          // Invalid or obsolete selectors are represented by a zero count.
        }
      }
      counts[name] = Math.min(9999, count);
    }
    const material = JSON.stringify(counts, Object.keys(counts).sort());
    let hash = 2166136261;
    for (let index = 0; index < material.length; index += 1) {
      hash ^= material.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return {version: VERSION, counts, fingerprint: (hash >>> 0).toString(16).padStart(8, "0")};
  }

  function createDomMonitor(root) {
    const state = {mutations: 0, added_nodes: 0, removed_nodes: 0, attributes: 0, overflow: false, last_mutation_at: ""};
    let observer = null;
    const target = root?.documentElement || root;
    if (typeof MutationObserver === "function" && target) {
      observer = new MutationObserver(entries => {
        for (const entry of entries.slice(0, 100)) {
          state.mutations += 1;
          state.added_nodes += Number(entry.addedNodes?.length || 0);
          state.removed_nodes += Number(entry.removedNodes?.length || 0);
          if (entry.type === "attributes") state.attributes += 1;
          if (state.mutations >= 10000) state.overflow = true;
        }
        state.mutations = Math.min(10000, state.mutations);
        state.added_nodes = Math.min(10000, state.added_nodes);
        state.removed_nodes = Math.min(10000, state.removed_nodes);
        state.attributes = Math.min(10000, state.attributes);
        state.last_mutation_at = new Date().toISOString();
      });
      try {
        observer.observe(target, {subtree: true, childList: true, attributes: true, attributeFilter: ["class", "data-view-name", "data-urn", "data-id"]});
      } catch (_error) {
        observer = null;
      }
    }
    return Object.freeze({
      snapshot() {
        return sanitize({version: VERSION, ...state});
      },
      disconnect() {
        observer?.disconnect();
      }
    });
  }

  globalThis.CodistanLinkedInParserHardening = Object.freeze({
    VERSION,
    normalizeText,
    sanitize,
    safeError,
    canonicalPostUrl,
    canonicalLeadUrl,
    evaluateLinkedInRecord,
    evaluateSalesNavigatorRecord,
    dedupeRecords,
    localizedAge,
    layoutSignature,
    createDomMonitor
  });
})();
