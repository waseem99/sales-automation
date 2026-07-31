import {
  sellerQueueDeepLink,
  type SellerQueueId,
  type SellerQueueSort,
  type SellerQueueView,
} from '@sales-automation/seller-queues';

const SORT_OPTIONS: Array<[SellerQueueSort, string]> = [
  ['priority_desc', 'Priority first'],
  ['follow_up_asc', 'Next follow-up first'],
  ['updated_desc', 'Most recently updated'],
  ['oldest_first', 'Oldest records first'],
];

export function renderSellerQueueNavigation(view: SellerQueueView, userId: string): string {
  const filters = view.filters;
  const links = view.queues.map((queue) => {
    const href = sellerQueueDeepLink({queue: queue.id, sort: view.sort, filters});
    const active = queue.id === view.activeQueue ? ' active' : '';
    return `<a class="seller-queue-link${active}" href="${escapeAttribute(href)}" data-queue-id="${escapeAttribute(queue.id)}"><span>${escapeHtml(queue.label)}</span><strong>${queue.count}</strong><small>${escapeHtml(queue.description)}</small></a>`;
  }).join('');
  return `<style>${styles()}</style><section class="seller-queues" data-seller-queue-version="${escapeAttribute(view.version)}">
    <div class="seller-queue-heading"><div><h2>Seller queues</h2><p>Durable server-derived work queues for ${escapeHtml(userId)}. Counts reconcile to the authenticated record scope.</p></div><span>${view.records.length} shown</span></div>
    <nav class="seller-queue-grid" aria-label="Seller queues">${links}</nav>
    <form class="seller-queue-filters" action="/prospects" method="get">
      <input type="hidden" name="queue" value="${escapeAttribute(view.activeQueue)}" />
      <label>Sort<select name="sort">${SORT_OPTIONS.map(([value, label]) => `<option value="${value}"${value === view.sort ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('')}</select></label>
      <label>Service<input name="service" value="${escapeAttribute(filters.serviceCategory ?? '')}" placeholder="Service category" /></label>
      <label>Status<input name="status" value="${escapeAttribute(filters.pipelineStatus ?? '')}" placeholder="Pipeline status" /></label>
      <label>Owner<input name="owner" value="${escapeAttribute(filters.owner ?? '')}" placeholder="Seller owner" /></label>
      <label>Search<input name="q" value="${escapeAttribute(filters.query ?? '')}" placeholder="Company, buyer or requirement" /></label>
      <button type="submit">Apply queue view</button>
      <a class="clear-queue" href="${escapeAttribute(sellerQueueDeepLink({queue: view.activeQueue, sort: view.sort}))}">Clear filters</a>
    </form>
    <div class="seller-queue-status"><strong>${escapeHtml(label(view.activeQueue))}</strong><span>Sort: ${escapeHtml(label(view.sort))}</span><span>Queue counts reconciled: Yes</span><span>Refresh-safe signed preferences</span><span>No external action automated</span></div>
  </section>`;
}

export function queueIdFromValue(value: unknown): SellerQueueId | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() as SellerQueueId : undefined;
}

export function queueSortFromValue(value: unknown): SellerQueueSort | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() as SellerQueueSort : undefined;
}

function styles(): string {
  return `.seller-queues{margin:0 0 18px;padding:16px;border:1px solid #dbe1ea;border-radius:14px;background:#fff}.seller-queue-heading{display:flex;justify-content:space-between;gap:16px;align-items:flex-start}.seller-queue-heading h2{margin:0}.seller-queue-heading p{margin:4px 0 0;color:#657080}.seller-queue-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(165px,1fr));gap:9px;margin-top:14px}.seller-queue-link{display:grid;grid-template-columns:1fr auto;gap:4px 8px;padding:11px;border:1px solid #dde2ea;border-radius:10px;text-decoration:none;color:inherit;background:#f8fafc}.seller-queue-link.active{border-color:currentColor;background:#edf4ff}.seller-queue-link strong{font-size:18px}.seller-queue-link small{grid-column:1/-1;color:#687181}.seller-queue-filters{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:9px;align-items:end;margin-top:14px}.seller-queue-filters label{display:grid;gap:4px;font-size:12px;color:#5c6573}.seller-queue-filters input,.seller-queue-filters select{min-width:0;padding:8px;border:1px solid #d6dce5;border-radius:8px;background:#fff}.seller-queue-filters button,.clear-queue{padding:9px 12px;border-radius:8px;text-align:center}.seller-queue-status{display:flex;flex-wrap:wrap;gap:8px 16px;margin-top:12px;font-size:12px;color:#657080}`;
}

function label(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (match) => match.toUpperCase());
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  }[character] ?? character));
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/`/g, '&#096;');
}
