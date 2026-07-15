import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  enhanceProspectPartialNavigation,
  extractProspectPartialContent,
} from '../vercel/prospect-partial-navigation.ts';

function main(): void {
  const script = readFileSync(new URL('../public/assets/prospect-partial-navigation.v1.js', import.meta.url), 'utf8');
  const styles = readFileSync(new URL('../public/assets/prospect-partial-navigation.v1.css', import.meta.url), 'utf8');
  assert.doesNotThrow(() => new Function(script), 'partial navigation browser asset must parse');
  assert.match(script, /x-prospect-partial/);
  assert.match(script, /pushState/);
  assert.match(script, /replaceState/);
  assert.match(script, /popstate/);
  assert.match(script, /prospect-drawer-close/);
  assert.match(script, /drawerEntry/);
  assert.match(script, /AbortController/);
  assert.match(script, /Retry/);
  assert.match(script, /partialMs/);
  assert.match(styles, /partial-loading/);
  assert.match(styles, /drawer-open/);
  assert.match(styles, /prefers-reduced-motion/);

  const source = '<!doctype html><html><head></head><body class="access-no-assign"><div class="app-shell"><main class="main"><header></header><section class="metrics"><a class="metric-link" href="/prospects?followUp=due">Due</a></section><form class="toolbar server-toolbar"><select name="followUp"><option value="due">Due</option></select></form><section class="workspace"><div class="prospect-list"><div class="table-wrap"><table><tbody><tr class="prospect-row selected"><td><a href="/prospects?leadId=x">X</a></td></tr></tbody></table></div></div>\n    <div class="detail-panel"><form data-action-form></form></div></section></main></div><script>base()</script></body></html>';
  const enhanced = enhanceProspectPartialNavigation(source, { drawerOpen: true });
  assert.match(enhanced, /<body class="access-no-assign drawer-open">/);
  assert.match(enhanced, /data-prospect-partial-root/);
  assert.match(enhanced, /id="prospect-drawer"/);
  assert.match(enhanced, /role="dialog"/);
  assert.match(enhanced, /prospect-partial-navigation\.v1\.css/);
  assert.match(enhanced, /prospect-partial-navigation\.v1\.js/);
  const fragment = extractProspectPartialContent(enhanced);
  assert.match(fragment, /^<div id="prospect-content"/);
  assert.match(fragment, /name="followUp"/);
  assert.doesNotMatch(fragment, /<html|<script/);
  assert.throws(() => extractProspectPartialContent('<html><body>No markers</body></html>'), /markers are missing/);

  const closed = enhanceProspectPartialNavigation(source, { drawerOpen: false });
  assert.match(closed, /<body class="access-no-assign">/);
  assert.doesNotMatch(closed, /<body[^>]*drawer-open/);
  assert.doesNotMatch(closed, /prospect-row selected/);

  const runtime = readFileSync(new URL('../vercel/workspace-dashboard-runtime.ts', import.meta.url), 'utf8');
  const neonQuery = readFileSync(new URL('../packages/neon-state/src/prospect-query.ts', import.meta.url), 'utf8');
  assert.match(runtime, /prospect-partial-navigation/);
  assert.match(runtime, /enhanceProspectPartialNavigation/);
  assert.match(runtime, /extractProspectPartialContent/);
  assert.match(runtime, /x-prospect-partial/);
  assert.match(runtime, /drawerOpen:\s*Boolean\(selectedId\)/);
  assert.match(runtime, /headers\.vary = 'x-prospect-partial'/);
  assert.match(neonQuery, /follow_ups_due/);
  assert.match(neonQuery, /filters\.followUp} = 'due'/);
  assert.match(neonQuery, /actionable_follow_up\(record\)/);

  console.log('Partial navigation, persistent filters, follow-up queue and lead drawer contract passed');
}

main();
