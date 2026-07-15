import type { ProspectPageResult } from '@sales-automation/neon-state';

export {
  buildWorkspacePage,
  resolveWorkspacePage,
  WORKSPACE_PAGES,
} from './workspace-page-model.js';
export type {
  WorkspacePageBuildResult,
  WorkspacePageDefinition,
  WorkspacePageId,
} from './workspace-page-model.js';

import type { WorkspacePageDefinition } from './workspace-page-model.js';

const SHELL_CSS = '/assets/prospect-desk-shell.v1.css';
const SHELL_JS = '/assets/prospect-desk-shell.v1.js';

interface NavigationLink {
  href: string;
  text: string;
  badge?: string;
}

interface NavigationGroup {
  id: string;
  label: string;
  links: NavigationLink[];
}

const navigationGroups: NavigationGroup[] = [
  {
    id: 'overview',
    label: 'Overview',
    links: [
      { href: '/prospects', text: 'All prospects' },
      { href: '/priorities', text: 'Priority queue' },
      { href: '/leads/research', text: 'Research queue' },
    ],
  },
  {
    id: 'warm-leads',
    label: 'Warm leads',
    links: [
      { href: '/leads/linkedin', text: 'LinkedIn warm leads' },
      { href: '/leads/upwork', text: 'Upwork saved searches' },
      { href: '/lead-signals', text: 'Signal intake' },
      { href: '/linkedin-signals', text: 'LinkedIn signals' },
    ],
  },
  {
    id: 'procurement',
    label: 'Procurement',
    links: [
      { href: '/leads/rfq', text: 'RFQs' },
      { href: '/leads/rfp', text: 'RFPs' },
      { href: '/leads/eoi', text: 'EOIs' },
      { href: '/leads/rfi', text: 'RFIs' },
      { href: '/leads/tenders', text: 'All tenders' },
      { href: '/tenders', text: 'Tender intelligence' },
    ],
  },
  {
    id: 'services',
    label: 'Services',
    links: [
      { href: '/services', text: 'Services overview' },
      { href: '/services/ai', text: 'AI and automation' },
      { href: '/services/software', text: 'Software and SaaS' },
      { href: '/services/cybersecurity', text: 'Cybersecurity' },
      { href: '/services/immersive', text: '3D, AR and VR' },
      { href: '/services/marketing', text: 'Web and marketing' },
    ],
  },
  {
    id: 'growth-system',
    label: 'Growth and system',
    links: [
      { href: '/leads/partnerships', text: 'Partnership leads' },
      { href: '/re-engagement', text: 'Re-engagement' },
      { href: '/portfolio', text: 'Portfolio proof' },
      { href: '/operations', text: 'Operations' },
      { href: '/delivery-health', text: 'Delivery health' },
    ],
  },
];

export function applyWorkspacePageChrome(
  html: string,
  page: WorkspacePageDefinition,
  summary: ProspectPageResult['summary'],
): string {
  let output = html;
  output = output.replace(/<title>Codistan Prospect Desk<\/title>/, `<title>${escapeHtml(page.title)} · Codistan Prospect Desk</title>`);
  output = output.replace(/href="\/prospects\?/g, `href="${page.route}?`);
  output = output.replace(/action="\/prospects"/g, `action="${page.route}"`);
  output = output.replace(/href="\/prospects\?pageSize=/g, `href="${page.route}?pageSize=`);
  output = output.replace(/<aside class="sidebar">[\s\S]*?<\/aside>/, renderWorkspaceSidebar(page.route, summary));
  output = output.replace(
    /<header class="topbar"><div>[\s\S]*?<\/div><div class="top-actions">/,
    `<header class="topbar"><div class="topbar-copy"><button id="sidebar-toggle" class="sidebar-toggle" type="button" aria-label="Open navigation" aria-controls="workspace-sidebar" aria-expanded="false">☰</button><nav class="breadcrumbs" aria-label="Breadcrumb"><a href="/prospects">Prospect Desk</a><span>/</span><span aria-current="page">${escapeHtml(page.navigationLabel)}</span></nav><p class="eyebrow">${escapeHtml(page.eyebrow)}</p><h1>${escapeHtml(page.title)}</h1><p>${escapeHtml(page.description)}</p></div><div class="top-actions">`,
  );
  output = output.replace(
    /<div class="prospect-list"><div class="section-heading"><div><h2>Prospects<\/h2><p>[\s\S]*?<\/p><\/div><\/div>/,
    `<div class="prospect-list"><div class="section-heading"><div><h2>${escapeHtml(page.listTitle)}</h2><p>${escapeHtml(page.listDescription)}</p></div></div>`,
  );
  output = output.replace(
    /<tr><td colspan="7" class="empty">[\s\S]*?<\/td><\/tr>/,
    `<tr><td colspan="7" class="empty">${escapeHtml(page.emptyMessage)}</td></tr>`,
  );
  output = output.replace(/<section class="lower-grid"[\s\S]*?<\/section>\s*<section class="panel runs-panel">[\s\S]*?<\/section>/, '');
  output = injectVersionedAssets(output);
  return output;
}

export function renderWorkspaceSidebar(activeRoute: string, summary?: ProspectPageResult['summary']): string {
  const queue = summary
    ? `<div class="sidebar-card" aria-label="Current workspace summary"><span>Current workspace</span><strong>${summary.total} visible</strong><small>${summary.followUpsDue} follow-ups due · ${summary.unassigned} unassigned</small></div>`
    : '';
  const groups = navigationGroups.map((group) => renderNavigationGroup(group, activeRoute)).join('');
  return `<aside class="sidebar" id="workspace-sidebar" aria-label="Prospect Desk navigation"><div class="brand"><div class="brand-mark" aria-hidden="true">C</div><div><strong>Codistan</strong><span>Prospect Desk</span></div><button id="sidebar-close" class="sidebar-close" type="button" aria-label="Close navigation">×</button></div><div class="workspace-scope"><span>Internal workspace</span><strong>Human-reviewed BD</strong></div><nav class="workspace-nav">${groups}</nav>${queue}<button id="logout-button" class="ghost full">Log out</button></aside>`;
}

function renderNavigationGroup(group: NavigationGroup, activeRoute: string): string {
  const active = group.links.some((link) => isActiveRoute(activeRoute, link.href));
  return `<details class="nav-group" data-nav-group="${escapeAttribute(group.id)}" ${active ? 'open' : ''}><summary><span>${escapeHtml(group.label)}</span><span class="nav-chevron" aria-hidden="true">⌄</span></summary><div class="nav-links">${group.links.map((link) => `<a class="nav-item ${isActiveRoute(activeRoute, link.href) ? 'active' : ''}" href="${escapeAttribute(link.href)}" ${isActiveRoute(activeRoute, link.href) ? 'aria-current="page"' : ''}><span>${escapeHtml(link.text)}</span>${link.badge ? `<small>${escapeHtml(link.badge)}</small>` : ''}</a>`).join('')}</div></details>`;
}

function injectVersionedAssets(html: string): string {
  let output = html;
  if (!output.includes(SHELL_CSS)) {
    output = output.replace('</head>', `<link rel="stylesheet" href="${SHELL_CSS}" /></head>`);
  }
  if (!output.includes(SHELL_JS)) {
    output = output.replace('</body>', `<script src="${SHELL_JS}" defer></script></body>`);
  }
  return output;
}

function isActiveRoute(activeRoute: string, href: string): boolean {
  if (activeRoute === href) return true;
  if (href === '/leads/tenders' && activeRoute === '/tenders') return true;
  return false;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/`/g, '&#96;');
}
