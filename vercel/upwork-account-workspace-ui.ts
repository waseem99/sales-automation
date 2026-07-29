import type { StoredLeadRecord } from '@sales-automation/storage';

export function enhanceUpworkAccountWorkspaceUi(html: string, selected?: StoredLeadRecord): string {
  if (!selected) return html;
  const lead = selected.lead;
  const raw = asRecord(lead.rawPayload);
  const intelligence = asRecord(raw.upworkAccountIntelligence);
  const linkedAccountLeadId = optionalString(raw.linkedAccountLeadId);
  const isWarmUpworkJob = lead.source === 'upwork' && lead.leadType === 'upwork_job';
  const isAccount = lead.source === 'partner_research'
    && lead.leadType === 'partner_prospect'
    && Array.isArray(raw.linkedUpworkJobIds);

  if (!isWarmUpworkJob && !isAccount) return html;
  const panel = isAccount
    ? renderAccountPanel(raw)
    : renderWarmJobPanel(intelligence, linkedAccountLeadId);
  if (!panel) return html;

  const activityMarker = '<section class="detail-section" id="activity-history" data-detail-section="activity-history"><h3>Activity history</h3>';
  if (html.includes(activityMarker)) return html.replace(activityMarker, `${panel}${activityMarker}`);
  const fallback = '<section class="detail-section"><h3>Activity timeline</h3>';
  if (html.includes(fallback)) return html.replace(fallback, `${panel}${fallback}`);
  return html;
}

function renderWarmJobPanel(intelligence: Record<string, unknown>, accountLeadId: string | undefined): string {
  if (Object.keys(intelligence).length === 0 && !accountLeadId) return '';
  const status = optionalString(intelligence.status) ?? 'not evaluated';
  const strength = optionalString(intelligence.identityStrength) ?? 'none';
  const missing = stringArray(intelligence.missingEvidence);
  const risks = stringArray(intelligence.risks);
  const accountLink = accountLeadId
    ? `<a class="button-link" href="/leads/partnerships?leadId=${encodeURIComponent(accountLeadId)}">Open linked account prospect</a>`
    : '<span class="muted">No account prospect was created. The Upwork job remains the only record.</span>';
  return `<section class="detail-section upwork-account-link" id="upwork-account-intelligence" data-detail-section="upwork-account-intelligence"><div class="section-heading"><div><p class="eyebrow">Upwork account intelligence</p><h3>Warm job and account relationship</h3><p>This job is a live opportunity. Any linked account is a separate cold partnership or product hypothesis.</p></div><span class="pill workflow-status">${escapeHtml(label(status))}</span></div><div class="detail-grid"><div><span>Identity strength</span><strong>${escapeHtml(label(strength))}</strong></div><div><span>Account prospect</span><strong>${accountLeadId ? 'Linked' : 'Not created'}</strong></div></div>${accountLink}${renderList('Missing evidence', missing)}${renderList('Risks and restrictions', risks)}</section>`;
}

function renderAccountPanel(raw: Record<string, unknown>): string {
  const buyerEvidence = asRecord(raw.buyerEvidence);
  const matches = objectArray(raw.campaignMatches);
  const linkedIds = stringArray(raw.linkedUpworkJobIds);
  const linkedUrls = stringArray(raw.linkedUpworkJobUrls);
  const strength = optionalString(raw.accountIdentityStrength) ?? optionalString(buyerEvidence.identityStrength) ?? 'unknown';
  const payment = buyerEvidence.paymentVerified === true ? 'Verified' : buyerEvidence.paymentVerified === false ? 'Unverified' : 'Not visible';
  const spend = optionalNumber(buyerEvidence.clientSpendUsd);
  const hireRate = optionalNumber(buyerEvidence.hireRatePercent);
  const restriction = optionalString(raw.platformRestriction) ?? 'The live job must follow Upwork communication rules. Any other route requires separately verified evidence and human approval.';
  const jobLinks = linkedIds.map((id, index) => {
    const sourceUrl = linkedUrls[index];
    const workspaceUrl = `/leads/upwork?leadId=${encodeURIComponent(id)}`;
    return `<li><a href="${escapeAttribute(workspaceUrl)}">Open warm job ${index + 1}</a>${sourceUrl ? ` <a class="source-link" href="${escapeAttribute(sourceUrl)}" target="_blank" rel="noreferrer">Original Upwork page</a>` : ''}</li>`;
  }).join('');
  const campaigns = matches.length > 0
    ? matches.map((match) => renderCampaignMatch(match)).join('')
    : '<p class="muted">No active account-level campaign match is stored.</p>';
  return `<section class="detail-section upwork-account-panel" id="upwork-account-intelligence" data-detail-section="upwork-account-intelligence"><div class="section-heading"><div><p class="eyebrow">Upwork account intelligence</p><h3>Cold account hypothesis linked to warm jobs</h3><p>This record does not convert a job request into account-level buying intent. Review one coordinated route before contact.</p></div><span class="pill workflow-status">${escapeHtml(label(strength))} identity</span></div><div class="detail-grid"><div><span>Linked warm jobs</span><strong>${linkedIds.length}</strong></div><div><span>Payment verification</span><strong>${escapeHtml(payment)}</strong></div><div><span>Visible client spend</span><strong>${spend === undefined ? 'Not visible' : `$${spend.toLocaleString('en-US')}`}</strong></div><div><span>Visible hire rate</span><strong>${hireRate === undefined ? 'Not visible' : `${hireRate}%`}</strong></div></div><div class="restriction-box"><strong>Platform restriction</strong><p>${escapeHtml(restriction)}</p></div><div class="linked-jobs"><h4>Linked Upwork jobs</h4>${jobLinks ? `<ul>${jobLinks}</ul>` : '<p class="muted">No linked job IDs are stored.</p>'}</div><div class="campaign-match-list"><h4>Account-level campaign hypotheses</h4>${campaigns}</div></section>`;
}

function renderCampaignMatch(match: Record<string, unknown>): string {
  const name = optionalString(match.campaignName) ?? 'Campaign match';
  const offer = optionalString(match.offerName) ?? 'Offer not recorded';
  const route = optionalString(match.route) ?? 'research';
  const disposition = optionalString(match.disposition) ?? 'research';
  const score = optionalNumber(match.score);
  const hypothesis = optionalString(match.inferredOpportunityHypothesis) ?? 'Account fit requires human research.';
  const missing = stringArray(match.missingEvidence);
  const risks = stringArray(match.risks);
  return `<article class="campaign-match-card"><div><strong>${escapeHtml(name)}</strong><span>${escapeHtml(offer)} · ${escapeHtml(label(route))}</span></div><span class="pill workflow-status">${escapeHtml(label(disposition))}${score === undefined ? '' : ` · ${score}`}</span><p>${escapeHtml(hypothesis)}</p>${renderList('Missing evidence', missing)}${renderList('Risks', risks)}</article>`;
}

function renderList(title: string, values: string[]): string {
  if (values.length === 0) return '';
  return `<div class="evidence-list"><strong>${escapeHtml(title)}</strong><ul>${values.slice(0, 8).map((value) => `<li>${escapeHtml(value)}</li>`).join('')}</ul></div>`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function objectArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(asRecord).filter((item) => Object.keys(item).length > 0) : [];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function label(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[character] ?? character));
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/`/g, '&#96;');
}
