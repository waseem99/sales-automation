const PARTIAL_START = '<!--prospect-partial:start-->';
const PARTIAL_END = '<!--prospect-partial:end-->';
const PARTIAL_CSS = '/assets/prospect-partial-navigation.v1.css';
const PARTIAL_JS = '/assets/prospect-partial-navigation.v1.js';

export interface ProspectPartialNavigationOptions {
  drawerOpen: boolean;
}

export function enhanceProspectPartialNavigation(
  html: string,
  options: ProspectPartialNavigationOptions,
): string {
  let output = html;
  output = output.replace(
    '<div class="detail-panel">',
    '<button id="prospect-drawer-backdrop" class="prospect-drawer-backdrop" type="button" aria-label="Close lead details"></button><div class="detail-panel" id="prospect-drawer" role="dialog" aria-modal="false" aria-label="Lead details"><button id="prospect-drawer-close" class="prospect-drawer-close" type="button" aria-label="Close lead details">×</button>',
  );
  if (!options.drawerOpen) output = output.replace('prospect-row selected', 'prospect-row');
  output = updateBodyClass(output, 'drawer-open', options.drawerOpen);
  output = output.replace(
    '<section class="metrics">',
    `${PARTIAL_START}<div id="prospect-content" data-prospect-partial-root><section class="metrics">`,
  );
  output = output.replace(/<\/main>(?=(?:<\/div>)?<script>|(?:<\/div>)?<\/body>)/, `</div>${PARTIAL_END}</main>`);
  if (!output.includes('data-prospect-partial-root') || !output.includes('id="prospect-drawer"')) {
    throw new Error('Prospect partial navigation could not attach to the rendered workspace.');
  }
  if (!output.includes(PARTIAL_CSS)) output = output.replace('</head>', `<link rel="stylesheet" href="${PARTIAL_CSS}" /></head>`);
  if (!output.includes(PARTIAL_JS)) output = output.replace('</body>', `<script src="${PARTIAL_JS}" defer></script></body>`);
  return output;
}

export function extractProspectPartialContent(html: string): string {
  const start = html.indexOf(PARTIAL_START);
  const end = html.indexOf(PARTIAL_END);
  if (start < 0 || end <= start) throw new Error('Prospect partial content markers are missing.');
  return html.slice(start + PARTIAL_START.length, end).trim();
}

function updateBodyClass(html: string, className: string, enabled: boolean): string {
  return html.replace(/<body(?: class="([^"]*)")?>/, (_match, existing: string | undefined) => {
    const classes = new Set((existing ?? '').split(/\s+/).filter(Boolean));
    if (enabled) classes.add(className); else classes.delete(className);
    const value = [...classes].join(' ');
    return value ? `<body class="${value}">` : '<body>';
  });
}
