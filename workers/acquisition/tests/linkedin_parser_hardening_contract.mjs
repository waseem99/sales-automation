import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const extensionRoot = path.resolve("extensions/linkedin");
const fixturePath = path.resolve("tests/fixtures/linkedin_parser_layouts.json");
const source = fs.readFileSync(path.join(extensionRoot, "parser-hardening.js"), "utf8");
const contentSource = fs.readFileSync(path.join(extensionRoot, "content.js"), "utf8");
const salesNavSource = fs.readFileSync(path.join(extensionRoot, "sales-nav.js"), "utf8");
const fixtures = JSON.parse(fs.readFileSync(fixturePath, "utf8"));

const sandbox = {
  console: {log() {}, warn() {}, error() {}},
  URL,
  WeakSet,
  Object,
  Array,
  Set,
  Map,
  Date,
  Math,
  JSON,
  RegExp,
  String,
  Number,
  Boolean,
  decodeURIComponent,
  encodeURIComponent,
};
sandbox.globalThis = sandbox;
vm.runInNewContext(source, sandbox, {filename: "parser-hardening.js"});
const guard = sandbox.CodistanLinkedInParserHardening;
assert(guard, "parser hardening API should be exposed");
assert.equal(guard.VERSION, "linkedin-parser-hardening-1.0.0");

const coveredLayouts = new Set(fixtures.map(item => item.layout));
for (const required of [
  "standard_feed_post",
  "search_result_card",
  "expanded_see_more",
  "repost_quoted_post",
  "company_post",
  "document_carousel",
  "external_link",
  "localized_date",
  "missing_fields",
  "sales_navigator_result",
  "sales_navigator_missing_fields",
  "infinite_scroll",
  "dom_mutations",
]) assert(coveredLayouts.has(required), `missing sanitized parser fixture: ${required}`);

for (const fixture of fixtures) {
  assert.equal(typeof fixture.dom_fixture, "string");
  assert(!/li_at=|jsessionid=|bearer\s+[a-z0-9]/i.test(fixture.dom_fixture), `${fixture.name} contains a secret-like DOM value`);
  if (fixture.surface === "linkedin_post") {
    const assessment = guard.evaluateLinkedInRecord(fixture.record);
    assert.equal(assessment.status, fixture.expected_status, fixture.name);
    assert.equal(assessment.external_action_automated, false);
    assert.equal(assessment.human_review_required, true);
    for (const field of fixture.expected_missing || []) {
      assert(assessment.missing_critical_fields.includes(field), `${fixture.name} missing diagnostic ${field}`);
    }
  }
  if (fixture.surface === "sales_navigator") {
    const assessment = guard.evaluateSalesNavigatorRecord(fixture.record);
    assert.equal(assessment.status, fixture.expected_status, fixture.name);
    assert.equal(assessment.external_action_automated, false);
    for (const field of fixture.expected_missing || []) {
      assert(assessment.missing_critical_fields.includes(field), `${fixture.name} missing diagnostic ${field}`);
    }
  }
  if (fixture.surface === "dedupe") {
    const deduped = guard.dedupeRecords(fixture.records);
    assert.equal(deduped.records.length, fixture.expected_unique, fixture.name);
    assert.equal(deduped.duplicates, fixture.expected_duplicates, fixture.name);
  }
  if (fixture.surface === "diagnostics") {
    const sanitized = guard.sanitize(fixture.diagnostic_input);
    for (const key of fixture.expected_redactions) assert.equal(sanitized[key], "[redacted]", `${fixture.name}:${key}`);
    assert.equal(sanitized.nested.csrf_token, "[redacted]");
    assert.equal(sanitized.nested.safe, "selector changed");
    assert(!JSON.stringify(sanitized).includes("private-token-value"));
    assert(!JSON.stringify(sanitized).includes("private conversation text"));
  }
  if (fixture.posted_age) {
    const age = guard.localizedAge(fixture.posted_age);
    assert.equal(age.status, fixture.expected_age_status, fixture.name);
  }
}

for (const [value, status] of [
  ["il y a 3 heures", "current"],
  ["hace 2 horas", "current"],
  ["3 jours", "current"],
  ["2 semanas", "stale"],
  ["1 Monat", "stale"],
]) assert.equal(guard.localizedAge(value).status, status, `localized age: ${value}`);

const safeError = guard.safeError(new Error("Authorization: Bearer abcdefghijklmnopqrstuvwxyz"));
assert(!safeError.includes("abcdefghijklmnopqrstuvwxyz"));
assert(safeError.includes("[redacted]"));

const monitor = guard.createDomMonitor({documentElement: {}});
const snapshot = monitor.snapshot();
assert.equal(snapshot.version, guard.VERSION);
assert.equal(snapshot.mutations, 0);
monitor.disconnect();

for (const marker of [
  "partial_parse_rejections",
  "layout_signature",
  "dom_mutations",
  "evaluateLinkedInRecord",
  "parser_status",
  "hardening.safeError",
]) assert(contentSource.includes(marker), `LinkedIn content parser missing ${marker}`);

for (const marker of [
  "partial_parse_rejections",
  "layout_signature",
  "dom_mutations",
  "evaluateSalesNavigatorRecord",
  "source_classification: \"cold_no_confirmed_intent\"",
  "buyer_intent_confirmed: false",
  "hardening.safeError",
]) assert(salesNavSource.includes(marker), `Sales Navigator parser missing ${marker}`);

for (const script of [source, contentSource, salesNavSource]) assert.doesNotThrow(() => new vm.Script(script));

const combined = `${source}\n${contentSource}\n${salesNavSource}`.toLowerCase();
for (const prohibited of [
  "document.cookie",
  "localstorage.getitem",
  "sessionstorage.getitem",
  "navigator.webdriver",
  "sendlinkedinmessage(",
  "connectrequest(",
  "external_action_automated: true",
  "external_action_performed: true",
]) assert(!combined.includes(prohibited), `parser hardening contains prohibited marker: ${prohibited}`);

console.log("LinkedIn parser hardening fixtures and safety contract passed.");
