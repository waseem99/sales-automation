(() => {
  "use strict";

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function numberFromText(value, suffix = "") {
    const normalized = String(value || "").replace(/,/g, "");
    const parsed = Number.parseFloat(normalized);
    if (!Number.isFinite(parsed)) return null;
    const multiplier = {K: 1_000, M: 1_000_000, B: 1_000_000_000}[String(suffix || "").toUpperCase()] || 1;
    return Math.round(parsed * multiplier * 100) / 100;
  }

  function firstMatch(text, pattern) {
    const match = pattern.exec(text);
    return match ? normalizeText(match[0]) : "";
  }

  function nativeIdFromUrl(value) {
    try {
      const url = new URL(value, "https://www.upwork.com");
      const match = /(~[A-Za-z0-9_-]{8,})/.exec(url.pathname);
      return match ? match[1] : "";
    } catch (_error) {
      return "";
    }
  }

  function parseCommercialEvidence(value) {
    const text = normalizeText(value);
    const fixed = /(?:Est\.?\s*Budget|Budget)\s*:?\s*\$([\d,.]+)/i.exec(text);
    const hourlyRange = /\$([\d,.]+)\s*-\s*\$([\d,.]+)\s*(?:\/hr|Hourly)/i.exec(text);
    const hourlySingle = /\$([\d,.]+)\s*(?:\/hr|Hourly)/i.exec(text);
    const spend = /\$([\d,.]+)\s*([KMB])?\+?\s+spent/i.exec(text);
    const hireRate = /(\d{1,3})%\s*hire rate/i.exec(text);
    const proposals = firstMatch(text, /(?:Less than\s+\d+|\d+\s+to\s+\d+|\d+\+)\s+proposals?/i);
    const postedAge = firstMatch(text, /Posted\s+(?:yesterday|\d+\s+(?:minute|hour|day|week)s?\s+ago)/i);
    const duration = firstMatch(text, /(?:Less than 1 month|1 to 3 months|3 to 6 months|More than 6 months)/i);
    const weeklyHours = firstMatch(text, /(?:Less than 30 hrs\/week|More than 30 hrs\/week|30\+ hrs\/week)/i);
    const experienceLevel = firstMatch(text, /(?:Entry Level|Intermediate|Expert)/i);
    const paymentVerified = /payment verified/i.test(text)
      ? true
      : (/payment unverified/i.test(text) ? false : null);

    const result = {
      engagement_type: /fixed-price/i.test(text) || fixed ? "fixed" : (/hourly/i.test(text) ? "hourly" : ""),
      fixed_budget_usd: fixed ? numberFromText(fixed[1]) : null,
      hourly_min_usd: hourlyRange ? numberFromText(hourlyRange[1]) : (hourlySingle ? numberFromText(hourlySingle[1]) : null),
      hourly_max_usd: hourlyRange ? numberFromText(hourlyRange[2]) : (hourlySingle ? numberFromText(hourlySingle[1]) : null),
      client_spend_usd: spend ? numberFromText(spend[1], spend[2]) : null,
      hire_rate_percent: hireRate ? Number.parseInt(hireRate[1], 10) : null,
      payment_verified: paymentVerified,
      proposals,
      posted_age: postedAge.replace(/^Posted\s+/i, ""),
      duration,
      weekly_hours: weeklyHours,
      experience_level: experienceLevel
    };

    return Object.fromEntries(
      Object.entries(result).filter(([, item]) => item !== null && item !== "")
    );
  }

  globalThis.CodistanUpworkEvidence = Object.freeze({
    nativeIdFromUrl,
    normalizeText,
    parseCommercialEvidence
  });
})();
