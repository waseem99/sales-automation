import nodemailer from 'nodemailer';
import type { Lead, PortfolioItem } from '@sales-automation/shared';
import type { ProspectDigestOptions, ProspectDiscoveryRun } from './types.js';

export interface ProspectDigestDelivery {
  status: 'sent' | 'skipped' | 'failed';
  message: string;
}

export async function sendProspectDigest(
  leads: Lead[],
  run: ProspectDiscoveryRun,
  options: ProspectDigestOptions | undefined,
  portfolioItems: PortfolioItem[],
): Promise<ProspectDigestDelivery> {
  if (!options?.to || !options.from || !options.smtpHost || !options.smtpUser || !options.smtpPassword) {
    return {
      status: 'skipped',
      message: 'Digest email skipped because SMTP or recipient configuration is incomplete.',
    };
  }

  if (leads.length === 0) {
    return {
      status: 'skipped',
      message: 'Digest email skipped because the run found no new prospects.',
    };
  }

  try {
    const transporter = nodemailer.createTransport({
      host: options.smtpHost,
      port: options.smtpPort ?? 587,
      secure: options.smtpSecure ?? false,
      auth: {
        user: options.smtpUser,
        pass: options.smtpPassword,
      },
    });

    const date = run.completedAt.slice(0, 10);
    const subject = `${options.subjectPrefix ?? 'Codistan Daily Prospects'} — ${leads.length} new — ${date}`;
    const html = renderProspectDigestHtml(leads, run, portfolioItems);
    const csv = renderProspectCsv(leads, portfolioItems);
    const result = await transporter.sendMail({
      from: options.from,
      to: options.to,
      subject,
      html,
      text: renderProspectDigestText(leads, run, portfolioItems),
      attachments: [
        {
          filename: `codistan-new-prospects-${date}.csv`,
          content: csv,
          contentType: 'text/csv; charset=utf-8',
        },
      ],
    });

    return {
      status: 'sent',
      message: `Prospect digest sent${result.messageId ? ` (${result.messageId})` : ''}.`,
    };
  } catch (error) {
    return {
      status: 'failed',
      message: `Prospect digest failed: ${(error as Error).message}`,
    };
  }
}

export function renderProspectDigestHtml(
  leads: Lead[],
  run: ProspectDiscoveryRun,
  portfolioItems: PortfolioItem[],
): string {
  const cards = leads.map((lead, index) => {
    const proof = getPortfolioNames(lead, portfolioItems);
    return `<article style="border:1px solid #d9dde5;border-radius:12px;padding:18px;margin:0 0 16px;background:#ffffff">
      <div style="font-size:12px;color:#667085;text-transform:uppercase;letter-spacing:.05em">#${index + 1} · ${escapeHtml(formatLabel(lead.opportunityStatus ?? 'partnership_target'))}</div>
      <h2 style="margin:6px 0 10px;font-size:20px;color:#101828">${escapeHtml(lead.companyName ?? lead.title)}</h2>
      <p style="margin:0 0 10px;color:#344054"><strong>Signal:</strong> ${escapeHtml(lead.title)}</p>
      <p style="margin:0 0 10px;color:#344054"><strong>Evidence:</strong> ${escapeHtml(lead.evidenceSummary ?? lead.description)}</p>
      <p style="margin:0 0 10px;color:#344054"><strong>Who to reach:</strong> ${escapeHtml(formatContact(lead))}</p>
      <p style="margin:0 0 10px;color:#344054"><strong>How to reach:</strong> ${renderContactLinks(lead)}</p>
      <p style="margin:0 0 10px;color:#344054"><strong>Recommended service:</strong> ${escapeHtml(formatLabel(lead.serviceCategory))}</p>
      <p style="margin:0 0 10px;color:#344054"><strong>What to share:</strong> ${escapeHtml(proof || 'Relevant Codistan capability deck and two closest approved case studies.')}</p>
      <p style="margin:0 0 10px;color:#344054"><strong>Suggested message:</strong><br>${escapeHtml(lead.draftMessage ?? buildFallbackMessage(lead))}</p>
      <p style="margin:0 0 10px;color:#344054"><strong>Next action:</strong> ${escapeHtml(lead.recommendedNextAction ?? 'Review the evidence and prepare human-approved outreach.')}</p>
      <p style="margin:0;color:#667085;font-size:13px">Source: ${linkOrText(lead.evidenceUrl ?? lead.sourceUrl, lead.discoverySource ?? lead.source)} · Discovered ${escapeHtml(lead.discoveredAt ?? lead.capturedAt)}</p>
    </article>`;
  }).join('');

  return `<!doctype html>
  <html><body style="margin:0;background:#f5f7fb;font-family:Arial,sans-serif;color:#101828">
    <div style="max-width:820px;margin:0 auto;padding:28px 18px">
      <h1 style="margin:0 0 8px">Codistan Daily Prospect Digest</h1>
      <p style="margin:0 0 20px;color:#475467">${leads.length} new prospect${leads.length === 1 ? '' : 's'} from ${run.sourceCount} sources. ${run.duplicateCount} duplicates were removed.</p>
      ${cards}
      <p style="color:#667085;font-size:12px">All outreach remains human-approved. The attached CSV contains the same prospect details.</p>
    </div>
  </body></html>`;
}

export function renderProspectCsv(leads: Lead[], portfolioItems: PortfolioItem[]): string {
  const headers = [
    'Company', 'Website', 'Opportunity Status', 'Signal Title', 'Evidence Summary', 'Evidence URL',
    'Discovery Source', 'Published At', 'Discovered At', 'Contact Name', 'Contact Role', 'Contact Email',
    'Contact Phone', 'Contact Form', 'LinkedIn', 'Country', 'Service Category', 'Recommended Profile',
    'Portfolio To Share', 'Suggested Message', 'Recommended Next Action', 'Pipeline Status', 'Lead ID',
  ];
  const rows = leads.map((lead) => [
    lead.companyName ?? '',
    lead.companyWebsite ?? '',
    lead.opportunityStatus ?? '',
    lead.title,
    lead.evidenceSummary ?? lead.description,
    lead.evidenceUrl ?? lead.sourceUrl ?? '',
    lead.discoverySource ?? lead.source,
    lead.postedAt ?? '',
    lead.discoveredAt ?? lead.capturedAt,
    lead.contactName ?? '',
    lead.contactRole ?? '',
    lead.contactEmail ?? '',
    lead.contactPhone ?? '',
    lead.contactFormUrl ?? '',
    lead.linkedinUrl ?? '',
    lead.country ?? '',
    lead.serviceCategory,
    lead.recommendedProfile ?? '',
    getPortfolioNames(lead, portfolioItems),
    lead.draftMessage ?? buildFallbackMessage(lead),
    lead.recommendedNextAction ?? '',
    lead.pipelineStatus,
    lead.id,
  ]);
  return `\uFEFF${[headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\n')}\n`;
}

function renderProspectDigestText(leads: Lead[], run: ProspectDiscoveryRun, portfolioItems: PortfolioItem[]): string {
  const body = leads.map((lead, index) => [
    `${index + 1}. ${lead.companyName ?? lead.title}`,
    `Status: ${formatLabel(lead.opportunityStatus ?? 'partnership_target')}`,
    `Signal: ${lead.title}`,
    `Evidence: ${lead.evidenceSummary ?? lead.description}`,
    `Who: ${formatContact(lead)}`,
    `Email: ${lead.contactEmail ?? 'Not publicly found'}`,
    `Website: ${lead.companyWebsite ?? 'Not resolved'}`,
    `Source: ${lead.evidenceUrl ?? lead.sourceUrl ?? lead.discoverySource ?? lead.source}`,
    `Service: ${formatLabel(lead.serviceCategory)}`,
    `Share: ${getPortfolioNames(lead, portfolioItems) || 'Relevant capability deck and approved case studies'}`,
    `Message: ${lead.draftMessage ?? buildFallbackMessage(lead)}`,
    '',
  ].join('\n')).join('\n');
  return `Codistan Daily Prospect Digest\n${leads.length} new prospects; ${run.duplicateCount} duplicates removed.\n\n${body}`;
}

function getPortfolioNames(lead: Lead, portfolioItems: PortfolioItem[]): string {
  const ids = lead.recommendedPortfolioItemIds ?? [];
  return ids.map((id) => portfolioItems.find((item) => item.id === id)?.projectName).filter(Boolean).join('; ');
}

function formatContact(lead: Lead): string {
  if (lead.contactName && lead.contactRole) return `${lead.contactName} — ${lead.contactRole}`;
  return lead.contactName ?? lead.contactRole ?? 'Founder, Managing Director, Head of Delivery, or relevant decision-maker';
}

function renderContactLinks(lead: Lead): string {
  const links: string[] = [];
  if (lead.contactEmail) links.push(`<a href="mailto:${escapeAttribute(lead.contactEmail)}">${escapeHtml(lead.contactEmail)}</a>`);
  if (lead.contactPhone) links.push(escapeHtml(lead.contactPhone));
  if (lead.contactFormUrl) links.push(linkOrText(lead.contactFormUrl, 'Contact form'));
  if (lead.linkedinUrl) links.push(linkOrText(lead.linkedinUrl, 'LinkedIn'));
  if (lead.companyWebsite) links.push(linkOrText(lead.companyWebsite, 'Website'));
  return links.length > 0 ? links.join(' · ') : 'Official website/contact page; no public direct contact was found.';
}

function buildFallbackMessage(lead: Lead): string {
  const company = lead.companyName ?? 'your team';
  const service = formatLabel(lead.serviceCategory);
  return `Hi, I noticed ${company}'s recent activity around ${lead.title}. Codistan can support this through ${service} and a dedicated delivery team. May I share two relevant examples and a focused collaboration approach?`;
}

function linkOrText(url: string | undefined, label: string): string {
  if (!url) return escapeHtml(label);
  try {
    const safe = new URL(url);
    if (safe.protocol !== 'http:' && safe.protocol !== 'https:') return escapeHtml(label);
    return `<a href="${escapeAttribute(safe.toString())}">${escapeHtml(label)}</a>`;
  } catch {
    return escapeHtml(label);
  }
}

function formatLabel(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function csvCell(value: unknown): string {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character] ?? character);
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/`/g, '&#96;');
}
