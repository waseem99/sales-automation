import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  enhanceProspectPartialNavigation,
  extractProspectPartialContent,
} from '../vercel/prospect-partial-navigation.ts';

function main(): void {
  const script = readFileSync(new URL('../public/assets/prospect-partial-navigation.v2.js', import.meta.url), 'utf8');
  const styles = readFileSync(new URL('../public/assets/prospect-partial-navigation.v2.css', import.meta.url), 'utf8');
  assert.doesNotThrow(() => new Function(script), 'partial navigation browser asset must parse');
  assert.match(script, /x-prospect-partial/);
  assert.match(script, /pushState/);
  assert.match(script, /replaceState/);
  assert.match(script, /popstate/);
  assert.match(script, /prospect-drawer-close/);
  assert.match(script, /drawerEntry/);
  assert.match(script, /AbortController/);
  assert.match(script, /Retry/);
  assert.match(script, /isRegisteredWorkspaceAnchor/);
  assert.match(script, /pathname\.startsWith\('\/leads\/'\)/);
  assert.match(script, /pathname\.startsWith\('\/services\/'\)/);
  assert.match(script, /workspaceUrl/);
  assert.match(script, /syncWorkspaceChrome/);
  assert.match(script, /prospectDocumentTitle/);
  assert.match(script, /x-prospect-server-ms/);
  assert.match(script, /prospect:partial-performance/);
  assert.match(script, /__prospectPerformance/);
  assert.match(script, /sessionStorage/);
  assert.match(script, /FILTER_BUDGET_MS = 500/);
  assert.match(script, /DRAWER_BUDGET_MS = 400/);
  assert.match(script, /focus\(\{ preventScroll: true \}\)/);
  assert.match(script, /closeMobileSidebar/);
  assert.doesNotMatch(script, /targetUrl\.search/);
  assert.match(styles, /partial-loading/);
  assert.match(styles, /partial-workspace-loading/);
  assert.match(styles, /prospect-skeleton/);
  assert.match(styles, /width:\s*44px/);
  assert.match(styles, /@media \(max-width: 800px\)/);
  assert.match(styles, /prefers-reduced-motion/);

  const source = '<!doctype html><html><head><title>LinkedIn Leads · Codistan Prospect Desk</title></head><body class="access-no-assign"><div class="app-shell"><aside id="workspace-sidebar"></aside><main class="main"><header class="topbar"><div><h1>LinkedIn Leads</h1></div></header><section class="metrics"><a class="metric-link" href="/leads/linkedin?followUp=due">Due</a></section><form class="toolbar server-toolbar"><select name="followUp"><option value="due">Due</option></select></form><section class="workspace"><div class="prospect-list"><div class="table-wrap"><table><tbody><tr class="prospect-row selected"><td><a href="/leads/linkedin?leadId=x">X</a></td></tr></tbody></table></div></div>\n    <div class="detail-panel"><form data-action-form></form></div></section></main></div><script>base()</script></body></html>';
  const enhanced = enhanceProspectPartialNavigation(source, {
    activeRoute: '/leads/linkedin',
    drawerOpen: true,
    documentTitle: 'LinkedIn Leads · Codistan Prospect Desk',
    navigationLabel: 'LinkedIn',
    eyebrow: 'Warm leads',
    title: 'LinkedIn Leads',
    description: 'Qualified LinkedIn opportunities.',
    serverMs: 123.6,
  });
  assert.match(enhanced, /<body class="access-no-assign drawer-open">/);
  assert.match(enhanced, /data-prospect-partial-root/);
  assert.match(enhanced, /data-prospect-workspace-route="\/leads\/linkedin"/);
  assert.match(enhanced, /data-prospect-document-title="LinkedIn Leads · Codistan Prospect Desk"/);
  assert.match(enhanced, /data-prospect-navigation-label="LinkedIn"/);
  assert.match(enhanced, /data-prospect-page-title="LinkedIn Leads"/);
  assert.match(enhanced, /data-prospect-server-ms="124"/);
  assert.match(enhanced, /id="prospect-drawer"/);
  assert.match(enhanced, /role="dialog"/);
  assert.match(enhanced, /prospect-partial-navigation\.v2\.css/);
  assert.match(enhanced, /prospect-partial-navigation\.v2\.js/);
  const fragment = extractProspectPartialContent(enhanced);
  assert.match(fragment, /^<div id="prospect-content"/);
  assert.doesNotMatch(fragment, /<header class="topbar">/);
  assert.match(fragment, /name="followUp"/);
  assert.doesNotMatch(fragment, /<html|<script/);
  assert.throws(() => extractProspectPartialContent('<html><body>No markers</body></html>'), /markers are missing/);

  const closed = enhanceProspectPartialNavigation(source, {
    activeRoute: '/leads/linkedin',
    drawerOpen: false,
    documentTitle: 'LinkedIn Leads · Codistan Prospect Desk',
    navigationLabel: 'LinkedIn',
    eyebrow: 'Warm leads',
    title: 'LinkedIn Leads',
    description: 'Qualified LinkedIn opportunities.',
  });
  assert.match(closed, /<body class="access-no-assign">/);
  assert.doesNotMatch(closed, /<body[^>]*drawer-open/);
  assert.doesNotMatch(closed, /prospect-row selected/);

  const runtime = readFileSync(new URL('../vercel/workspace-dashboard-runtime.ts', import.meta.url), 'utf8');
  const neonQuery = readFileSync(new URL('../packages/neon-state/src/prospect-query.ts', import.meta.url), 'utf8');
  assert.match(runtime, /prospect-partial-navigation/);
  assert.match(runtime, /enhanceProspectPartialNavigation/);
  assert.match(runtime, /extractProspectPartialContent/);
  assert.match(runtime, /activeRoute:\s*pathname/);
  assert.match(runtime, /drawerOpen:\s*Boolean\(selectedId\)/);
  assert.match(runtime, /x-prospect-partial-route/);
  assert.match(runtime, /x-prospect-server-ms/);
  assert.match(runtime, /server-timing/);
  assert.match(runtime, /prospect_records/);
  assert.match(runtime, /prospect_total/);
  assert.match(runtime, /appendVary/);
  assert.match(neonQuery, /follow_ups_due/);
  assert.match(neonQuery, /filters\.followUp} = 'due'/);
  assert.match(neonQuery, /actionable_follow_up\(record\)/);

  console.log('Cross-workspace partial navigation, timing, responsive drawer and follow-up queue contract passed');
}

main();
