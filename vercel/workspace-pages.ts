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

const SHELL_CSS = '/assets/prospect-desk-shell.v2.css';
const SHELL_JS = '/assets/prospect-desk-shell.v2.js';

export interface WorkspaceSidebarSummary {
  total: number;
  totalLabel?: string;
  detail?: string;
  followUpsDue?: number;
  unassigned?: number;
}

export interface SpecializedPageShellOptions {
  activeRoute: string;
  eyebrow: string;
  title: string;
  description: string;
  actor: string;
  scopeLabel: string;
  summary?: WorkspaceSidebarSummary;
}

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

interface WorkspaceTab {
  href: string;
  text: string;
  activeRoutes?: string[];
}

const navigationGroups: NavigationGroup[] = [
  {
    id: 'daily-work',
    label: 'Daily work',
    links: [
      { href: '/prospects', text: 'Prospects' },
      { href: '/priorities', text: 'Priorities' },
      { href: '/operations', text: 'Operations' },
    ],
  },
  {
    id: 'more',
    label: 'More',
    links: [
      { href: '/linkedin-signals', text: 'LinkedIn intake' },
      { href: '/lead-signals', text: 'Signal intake' },
      { href: '/tenders', text: 'Tender intelligence' },
      { href: '/re-engagement', text: 'Re-engagement' },
      { href: '/portfolio', text: 'Portfolio proof' },
      { href: '/delivery-health', text: 'Delivery health' },
    ],
  },
];

const workspaceTabs: WorkspaceTab[] = [
  { href: '/prospects', text: 'All' },
  { href: '/leads/linkedin', text: 'LinkedIn' },
  { href: '/leads/upwork', text: 'Upwork' },
  {
    href: '/leads/tenders',
    text: 'Tenders',
    activeRoutes: ['/leads/rfq', '/leads/rfp', '/leads/eoi', '/leads/rfi', '/leads/tenders'],
  },
  { href: '/leads/research', text: 'Research' },
  { href: '/leads/partnerships', text: 'Partnerships' },
  {
    href: '/services',
    text: 'Services',
    activeRoutes: ['/services', '/services/ai', '/services/software', '/services/cybersecurity', '/services/immersive', '/services/marketing'],
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
  output = output.replace(
    /(<form class="toolbar server-toolbar")/,
    `${renderWorkspaceTabs(page.route)}$1`,
  );
  output = output.replace(/<section class="lower-grid"[\s\S]*?<\/section>\s*<section class="panel runs-panel">[\s\S]*?<\/section>/, '');
  return injectVersionedAssets(output);
}

export function applySpecializedPageShell(html: string, options: SpecializedPageShellOptions): string {
  let output = replaceSpecializedHeader(html, options);
  output = output.replace(
    '<body><main class="shell">',
    `<body><div class="app-shell">${renderWorkspaceSidebar(options.activeRoute, options.summary, options.scopeLabel)}<main class="main specialized-main"><div class="specialized-content">`,
  );
  output = output.replace(/<\/main>(?=(?:<script>|<\/body>))/, '</div></main></div>');
  return injectVersionedAssets(output);
}

export function renderWorkspaceSidebar(
  activeRoute: string,
  summary?: WorkspaceSidebarSummary,
  scopeLabel = 'Human-reviewed BD',
): string {
  const queue = summary ? renderSidebarSummary(summary) : '';
  const groups = navigationGroups.map((group) => renderNavigationGroup(group, activeRoute)).join('');
  return `<aside class="sidebar" id="workspace-sidebar" aria-label="Prospect Desk navigation"><div class="brand"><div class="brand-mark" aria-hidden="true">C</div><div><strong>Codistan</strong><span>Prospect Desk</span></div><button id="sidebar-close" class="sidebar-close" type="button" aria-label="Close navigation">×</button></div><div class="workspace-scope"><span>Current scope</span><strong>${escapeHtml(scopeLabel)}</strong></div><nav class="workspace-nav">${groups}</nav>${queue}<button id="logout-button" class="ghost full" type="button" data-shell-logout>Log out</button></aside>`;
}

function replaceSpecializedHeader(html: string, options: SpecializedPageShellOptions): string {
  const headerPattern = /<header><div>[\s\S]*?<\/div><div class="actions">([\s\S]*?)<\/div><\/header>/;
  const sectionPattern = /<section class="top"><div>[\s\S]*?<\/div><div class="actions">([\s\S]*?)<\/div><\/section>/;
  const match = html.match(headerPattern) ?? html.match(sectionPattern);
  const actions = match?.[1] ?? '';
  const replacement = `<header class="topbar specialized-topbar"><div class="topbar-copy"><button id="sidebar-toggle" class="sidebar-toggle" type="button" aria-label="Open navigation" aria-controls="workspace-sidebar" aria-expanded="false">☰</button><nav class="breadcrumbs" aria-label="Breadcrumb"><a href="/prospects">Prospect Desk</a><span>/</span><span aria-current="page">${escapeHtml(options.title)}</span></nav><p class="eyebrow">${escapeHtml(options.eyebrow)}</p><h1>${escapeHtml(options.title)}</h1><p>${escapeHtml(options.description)}</p><small class="signed-in">Signed in as ${escapeHtml(options.actor)} · ${escapeHtml(options.scopeLabel)}</small></div><div class="actions top-actions">${actions}</div></header>`;
  if (headerPattern.test(html)) return html.replace(headerPattern, replacement);
  if (sectionPattern.test(html)) return html.replace(sectionPattern, replacement);
  return html;
}

function renderSidebarSummary(summary: WorkspaceSidebarSummary): string {
  const totalLabel = summary.totalLabel ?? 'visible';
  const detail = summary.detail ?? `${summary.followUpsDue ?? 0} follow-ups due · ${summary.unassigned ?? 0} unassigned`;
  return `<div class="sidebar-card" aria-label="Current workspace summary"><span>Current workspace</span><strong>${summary.total} ${escapeHtml(totalLabel)}</strong><small>${escapeHtml(detail)}</small></div>`;
}

function renderNavigationGroup(group: NavigationGroup, activeRoute: string): string {
  const active = group.links.some((link) => isActiveRoute(activeRoute, link.href));
  const open = group.id === 'daily-work' || active;
  return `<details class="nav-group" data-nav-group="${escapeAttribute(group.id)}" ${open ? 'open' : ''}><summary><span>${escapeHtml(group.label)}</span><span class="nav-chevron" aria-hidden="true">⌄</span></summary><div class="nav-links">${group.links.map((link) => `<a class="nav-item ${isActiveRoute(activeRoute, link.href) ? 'active' : ''}" href="${escapeAttribute(link.href)}" ${isActiveRoute(activeRoute, link.href) ? 'aria-current="page"' : ''}><span>${escapeHtml(link.text)}</span>${link.badge ? `<small>${escapeHtml(link.badge)}</small>` : ''}</a>`).join('')}</div></details>`;
}

function renderWorkspaceTabs(activeRoute: string): string {
  return `<nav class="workspace-tabs" aria-label="Prospect views">${workspaceTabs.map((tab) => {
    const active = tab.activeRoutes?.includes(activeRoute) ?? activeRoute === tab.href;
    return `<a href="${escapeAttribute(tab.href)}" class="workspace-tab ${active ? 'active' : ''}" ${active ? 'aria-current="page"' : ''}>${escapeHtml(tab.text)}</a>`;
  }).join('')}</nav>`;
}

function injectVersionedAssets(html: string): string {
  let output = html;
  if (!output.includes(SHELL_CSS)) output = output.replace('</head>', `<link rel="stylesheet" href="${SHELL_CSS}" /></head>`);
  if (!output.includes(SHELL_JS)) output = output.replace('</body>', `<script src="${SHELL_JS}" defer></script></body>`);
  return output;
}

function isActiveRoute(activeRoute: string, href: string): boolean {
  if (activeRoute === href) return true;
  if (href === '/prospects' && (activeRoute.startsWith('/leads/') || activeRoute.startsWith('/services'))) return true;
  return false;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/`/g, '&#96;');
}
