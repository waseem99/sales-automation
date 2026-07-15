export interface DedicatedPageLayoutOptions {
  activeRoute: string;
  eyebrow: string;
  title: string;
  description: string;
  actor: string;
  scopeLabel: string;
}

const SHELL_CSS = '/assets/prospect-desk-shell.v2.css';
const SHELL_JS = '/assets/prospect-desk-shell.v2.js';

export async function applyDedicatedPageLayout(html: string, options: DedicatedPageLayoutOptions): Promise<string> {
  const workspace = await import('./workspace-pages.js');
  let output = normalizeWorkspaceLinks(html, options.activeRoute);
  output = replacePageHeader(output, options);
  output = output.replace(
    /<body>\s*<main(?:\s+class="[^"]*")?>/,
    `<body><div class="app-shell">${workspace.renderWorkspaceSidebar(options.activeRoute, undefined, options.scopeLabel)}<main class="main specialized-main"><div class="specialized-content">`,
  );
  output = output.replace(/<\/main>\s*(?=(?:<script>|<\/body>))/, '</div></main></div>');
  if (!output.includes(SHELL_CSS)) output = output.replace('</head>', `<link rel="stylesheet" href="${SHELL_CSS}" /></head>`);
  if (!output.includes(SHELL_JS)) output = output.replace('</body>', `<script src="${SHELL_JS}" defer></script></body>`);
  return output;
}

function normalizeWorkspaceLinks(html: string, activeRoute: string): string {
  const apiRoute = `/api${activeRoute}`;
  return html.replaceAll(`action="${apiRoute}"`, `action="${activeRoute}"`).replaceAll(`href="${apiRoute}"`, `href="${activeRoute}"`);
}

function replacePageHeader(html: string, options: DedicatedPageLayoutOptions): string {
  const actionHeader = /<header><div>[\s\S]*?<\/div><div class="actions">([\s\S]*?)<\/div><\/header>/;
  const actionSection = /<section class="top"><div>[\s\S]*?<\/div><div class="actions">([\s\S]*?)<\/div><\/section>/;
  const navigationHeader = /<header><div>[\s\S]*?<\/div><nav>([\s\S]*?)<\/nav><\/header>/;
  const match = html.match(actionHeader) ?? html.match(actionSection) ?? html.match(navigationHeader);
  const actions = match?.[1] ?? '';
  const replacement = `<header class="topbar specialized-topbar"><div class="topbar-copy"><button id="sidebar-toggle" class="sidebar-toggle" type="button" aria-label="Open navigation" aria-controls="workspace-sidebar" aria-expanded="false">☰</button><nav class="breadcrumbs" aria-label="Breadcrumb"><a href="/prospects">Prospect Desk</a><span>/</span><span aria-current="page">${escapeHtml(options.title)}</span></nav><p class="eyebrow">${escapeHtml(options.eyebrow)}</p><h1>${escapeHtml(options.title)}</h1><p>${escapeHtml(options.description)}</p><small class="signed-in">Signed in as ${escapeHtml(options.actor)} · ${escapeHtml(options.scopeLabel)}</small></div><div class="actions top-actions">${actions}</div></header>`;
  if (actionHeader.test(html)) return html.replace(actionHeader, replacement);
  if (actionSection.test(html)) return html.replace(actionSection, replacement);
  if (navigationHeader.test(html)) return html.replace(navigationHeader, replacement);
  return html.replace(/<body>\s*<main(?:\s+class="[^"]*")?>/, (opening) => `${opening}${replacement}`);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
}
