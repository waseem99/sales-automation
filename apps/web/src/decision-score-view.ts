import type {Lead} from '@sales-automation/shared';

const COMPONENTS = [
  ['account_fit', 'Account fit'],
  ['contact_fit', 'Contact fit'],
  ['buyer_intent', 'Buyer intent'],
  ['service_fit', 'Service fit'],
  ['evidence_quality', 'Evidence quality'],
  ['freshness', 'Freshness'],
  ['commercial_readiness', 'Commercial readiness'],
] as const;

export function renderDecisionScorePanel(lead: Lead): string {
  const raw = asRecord(lead.rawPayload);
  const score = asRecord(raw.decisionScore);
  if (score.version !== 'decision-score.v1') {
    return `<section class="detail-section score-components"><h3>Decision score</h3><p class="muted">Component scoring has not been calculated for this prospect yet.</p></section>`;
  }
  const components = asRecord(score.components);
  const reasons = stringArray(score.reasons);
  const missing = stringArray(score.missingEvidence);
  const risks = stringArray(score.risks);
  const overrides = arrayValue(score.overrideHistory).map(asRecord);
  const original = asRecord(score.originalScore);
  const total = numberValue(score.total);
  const riskPenalty = numberValue(score.riskPenalty);
  const priority = text(score.priority) ?? 'research';
  const version = text(score.version) ?? 'unknown';
  const hash = text(score.resultHash) ?? '';
  const buyerIntentConfirmed = score.buyerIntentConfirmed === true;
  const coldSourcePreserved = score.coldSourcePreserved === true;
  const needsSellerReview = raw.decisionScoreNeedsSellerReview === true;

  return `<section class="detail-section score-components" data-decision-score-version="${escapeAttribute(version)}">
    <div class="section-heading"><div><h3>Decision score</h3><p>Versioned fit, intent, evidence and commercial-readiness components.</p></div><span class="score">${total ?? '—'}<small>/100</small></span></div>
    <div class="score-summary"><span class="pill">${escapeHtml(label(priority))}</span><span>Risk penalty: ${riskPenalty ?? '—'}</span><span>Buyer intent: ${buyerIntentConfirmed ? 'Confirmed' : 'Not confirmed'}</span><span>Cold source preserved: ${coldSourcePreserved ? 'Yes' : 'No'}</span></div>
    ${needsSellerReview ? '<div class="warning">New source evidence is available. The seller override remains protected until a human reviews the latest model candidate.</div>' : ''}
    <div class="score-component-grid">${COMPONENTS.map(([key, title]) => componentCard(title, numberValue(components[key]))).join('')}</div>
    <div class="score-evidence-grid">
      ${evidenceList('Positive reasons', reasons, 'No positive reasons recorded.')}
      ${evidenceList('Missing evidence', missing, 'No missing evidence recorded.')}
      ${evidenceList('Risks', risks, 'No score risks recorded.')}
    </div>
    ${overrides.length > 0 ? `<div class="override-history"><h4>Seller override history</h4>${overrides.map(renderOverride).join('')}</div>` : ''}
    ${Object.keys(original).length > 0 ? `<p class="muted">Original model result retained: ${escapeHtml(String(original.total ?? '—'))}/100 · ${escapeHtml(label(String(original.priority ?? 'research')))}.</p>` : ''}
    <small>Model ${escapeHtml(version)}${hash ? ` · Result ${escapeHtml(hash.slice(0, 12))}` : ''} · Human review required · No external action automated.</small>
  </section>`;
}

function componentCard(title: string, value: number | undefined): string {
  const score = value ?? 0;
  return `<div class="score-component"><span>${escapeHtml(title)}</span><strong>${value ?? '—'}</strong><div class="score-bar"><i style="width:${Math.max(0, Math.min(100, score))}%"></i></div></div>`;
}

function evidenceList(title: string, values: string[], empty: string): string {
  return `<div><h4>${escapeHtml(title)}</h4>${values.length > 0 ? `<ul>${values.slice(0, 8).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : `<p class="muted">${escapeHtml(empty)}</p>`}</div>`;
}

function renderOverride(value: Record<string, unknown>): string {
  const actor = text(value.actor) ?? 'Unknown seller';
  const reason = text(value.reason) ?? 'No reason';
  const outcome = text(value.outcome) ?? 'No outcome';
  const component = text(value.component) ?? 'priority';
  const occurredAt = text(value.occurredAt) ?? '';
  return `<article><strong>${escapeHtml(actor)}</strong><span>${escapeHtml(label(component))} · ${escapeHtml(occurredAt)}</span><p>${escapeHtml(reason)}</p><small>${escapeHtml(outcome)}</small></article>`;
}

function label(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (match) => match.toUpperCase());
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  }[character] ?? character));
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/`/g, '&#096;');
}
