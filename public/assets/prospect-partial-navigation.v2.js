(() => {
  const PARTIAL_HEADER = 'x-prospect-partial';
  const PERFORMANCE_STORAGE = 'prospect-partial-performance-v1';
  const PERFORMANCE_LIMIT = 50;
  const FILTER_BUDGET_MS = 500;
  const WORKSPACE_BUDGET_MS = 500;
  const DRAWER_BUDGET_MS = 400;
  let activeRequest;
  let searchTimer;
  let retryAction;

  const contentRoot = () => document.getElementById('prospect-content');
  const tableWrap = () => contentRoot()?.querySelector('.table-wrap');

  function captureState() {
    return {
      windowY: window.scrollY,
      tableY: tableWrap()?.scrollTop || 0,
      drawer: new URL(location.href).searchParams.has('leadId'),
    };
  }

  function saveCurrentState() {
    history.replaceState({
      ...history.state,
      ...captureState(),
      drawerEntry: Boolean(history.state?.drawerEntry),
    }, '', location.href);
  }

  function restoreScroll(state) {
    requestAnimationFrame(() => {
      window.scrollTo(0, Number(state?.windowY || 0));
      const table = tableWrap();
      if (table) table.scrollTop = Number(state?.tableY || 0);
    });
  }

  function setLoading(loading, kind = 'content') {
    document.body.classList.toggle('partial-loading', loading);
    document.body.classList.toggle('partial-workspace-loading', loading && kind === 'workspace');
    const root = contentRoot();
    if (root) root.setAttribute('aria-busy', loading ? 'true' : 'false');
  }

  function toastElement() {
    let element = document.getElementById('prospect-toast');
    if (!element) {
      element = document.createElement('div');
      element.id = 'prospect-toast';
      element.className = 'prospect-toast';
      element.setAttribute('role', 'status');
      element.setAttribute('aria-live', 'polite');
      document.body.append(element);
    }
    return element;
  }

  function showToast(message, type = 'success', retry) {
    const element = toastElement();
    element.className = `prospect-toast show ${type}`;
    element.replaceChildren();
    const text = document.createElement('span');
    text.textContent = String(message || 'Done');
    element.append(text);
    retryAction = retry;
    if (retry) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Retry';
      button.addEventListener('click', () => retryAction?.());
      element.append(button);
    }
    window.clearTimeout(Number(element.dataset.timer || 0));
    element.dataset.timer = String(window.setTimeout(() => element.classList.remove('show'), retry ? 8000 : 3200));
  }

  function syncDrawer(focusDrawer = false) {
    const open = new URL(location.href).searchParams.has('leadId');
    document.body.classList.toggle('drawer-open', open);
    const drawer = document.getElementById('prospect-drawer');
    if (drawer) {
      drawer.setAttribute('aria-hidden', open ? 'false' : 'true');
      drawer.setAttribute('aria-modal', open ? 'true' : 'false');
    }
    if (open && focusDrawer) document.getElementById('prospect-drawer-close')?.focus();
  }

  function parsePartial(html) {
    const template = document.createElement('template');
    template.innerHTML = html.trim();
    const root = template.content.querySelector('#prospect-content');
    if (!(root instanceof HTMLElement)) throw new Error('The updated lead workspace could not be read.');
    return root;
  }

  function closeMobileSidebar() {
    document.getElementById('workspace-sidebar')?.classList.remove('is-open');
    document.getElementById('sidebar-toggle')?.setAttribute('aria-expanded', 'false');
    document.querySelector('.workspace-sidebar-backdrop')?.remove();
    document.body.classList.remove('nav-open');
  }

  function normalizePath(pathname) {
    return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  }

  function syncSidebar(pathname) {
    const targetPath = normalizePath(pathname);
    document.querySelectorAll('.workspace-nav .nav-item').forEach((link) => {
      if (!(link instanceof HTMLAnchorElement)) return;
      const active = normalizePath(new URL(link.href, location.href).pathname) === targetPath;
      link.classList.toggle('active', active);
      if (active) {
        link.setAttribute('aria-current', 'page');
        link.closest('details')?.setAttribute('open', '');
      } else {
        link.removeAttribute('aria-current');
      }
    });
  }

  function isRegisteredWorkspaceAnchor(anchor) {
    if (!anchor.matches('.workspace-nav .nav-item,.breadcrumbs a')) return false;
    const pathname = normalizePath(new URL(anchor.href, location.href).pathname);
    return pathname === '/prospects'
      || pathname.startsWith('/leads/')
      || pathname === '/services'
      || pathname.startsWith('/services/');
  }

  function syncWorkspaceChrome(root, pathname) {
    document.title = root.dataset.prospectDocumentTitle || document.title;
    const topbar = document.querySelector('.topbar-copy');
    if (topbar) {
      const breadcrumb = topbar.querySelector('.breadcrumbs [aria-current="page"]');
      if (breadcrumb) breadcrumb.textContent = root.dataset.prospectNavigationLabel || '';
      const eyebrow = topbar.querySelector('.eyebrow');
      if (eyebrow) eyebrow.textContent = root.dataset.prospectEyebrow || '';
      const heading = topbar.querySelector('h1');
      if (heading) heading.textContent = root.dataset.prospectPageTitle || '';
      const description = [...topbar.children].find((element) => element.tagName === 'P' && !element.classList.contains('eyebrow'));
      if (description) description.textContent = root.dataset.prospectDescription || '';
    }
    syncSidebar(pathname);
  }

  function workspaceUrl(anchor) {
    const target = new URL(anchor.href, location.href);
    const current = new URL(location.href);
    for (const key of ['search', 'status', 'signal', 'service', 'owner', 'feedback', 'followUp', 'pageSize']) {
      const value = current.searchParams.get(key);
      if (value && !target.searchParams.has(key)) target.searchParams.set(key, value);
    }
    target.searchParams.delete('leadId');
    target.searchParams.set('page', '1');
    return target;
  }

  function timingBudget(kind) {
    if (kind === 'drawer') return DRAWER_BUDGET_MS;
    if (kind === 'workspace') return WORKSPACE_BUDGET_MS;
    return FILTER_BUDGET_MS;
  }

  function readPerformanceSamples() {
    try {
      const parsed = JSON.parse(sessionStorage.getItem(PERFORMANCE_STORAGE) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function recordPerformance(kind, targetUrl, totalMs, serverMs) {
    const budgetMs = timingBudget(kind);
    const sample = {
      kind,
      pathname: targetUrl.pathname,
      totalMs: Math.round(totalMs),
      serverMs: Math.max(0, Math.round(serverMs || 0)),
      budgetMs,
      withinBudget: totalMs <= budgetMs,
      recordedAt: new Date().toISOString(),
    };
    const samples = [...readPerformanceSamples(), sample].slice(-PERFORMANCE_LIMIT);
    try { sessionStorage.setItem(PERFORMANCE_STORAGE, JSON.stringify(samples)); } catch {}
    const root = contentRoot();
    if (root) {
      root.dataset.partialMs = String(sample.totalMs);
      root.dataset.partialServerMs = String(sample.serverMs);
      root.dataset.partialKind = kind;
      root.dataset.partialWithinBudget = String(sample.withinBudget);
    }
    performance.mark?.(`prospect-${kind}-complete`);
    try { performance.measure?.(`prospect-partial-${kind}`, `prospect-${kind}-start`, `prospect-${kind}-complete`); } catch {}
    window.dispatchEvent(new CustomEvent('prospect:partial-performance', { detail: sample }));
    if (!sample.withinBudget) console.warn('Prospect partial navigation exceeded its budget.', sample);
    return sample;
  }

  window.__prospectPerformance = {
    samples: readPerformanceSamples,
    summary() {
      const samples = readPerformanceSamples();
      return samples.reduce((result, sample) => {
        const bucket = result[sample.kind] || { count: 0, totalMs: 0, maxMs: 0, withinBudget: 0 };
        bucket.count += 1;
        bucket.totalMs += Number(sample.totalMs || 0);
        bucket.maxMs = Math.max(bucket.maxMs, Number(sample.totalMs || 0));
        bucket.withinBudget += sample.withinBudget ? 1 : 0;
        result[sample.kind] = bucket;
        return result;
      }, {});
    },
    clear() { sessionStorage.removeItem(PERFORMANCE_STORAGE); },
  };

  async function navigate(url, options = {}) {
    const target = new URL(url, location.href);
    if (target.origin !== location.origin) {
      location.href = target.href;
      return;
    }
    const previousState = captureState();
    if (options.historyMode !== 'none') saveCurrentState();
    activeRequest?.abort();
    const controller = new AbortController();
    activeRequest = controller;
    const kind = options.kind || 'filter';
    setLoading(true, kind);
    const startedAt = performance.now();
    performance.mark?.(`prospect-${kind}-start`);
    const retry = () => navigate(target.href, options);
    try {
      const response = await fetch(target.href, {
        headers: { [PARTIAL_HEADER]: 'content', accept: 'text/html' },
        credentials: 'same-origin',
        signal: controller.signal,
      });
      if (response.status === 401 || (response.redirected && new URL(response.url).pathname === '/login')) {
        location.href = '/login';
        return;
      }
      if (!response.ok) throw new Error(`Workspace update failed with status ${response.status}.`);
      const nextRoot = parsePartial(await response.text());
      const currentRoot = contentRoot();
      if (!currentRoot) throw new Error('The current lead workspace is unavailable.');
      currentRoot.replaceWith(nextRoot);
      const drawerOpen = target.searchParams.has('leadId');
      const nextState = {
        windowY: options.preserveScroll ? previousState.windowY : 0,
        tableY: options.preserveScroll ? previousState.tableY : 0,
        drawer: drawerOpen,
        drawerEntry: options.historyMode === 'push' && drawerOpen ? true : Boolean(history.state?.drawerEntry),
      };
      if (options.historyMode === 'replace') history.replaceState(nextState, '', target.href);
      else if (options.historyMode !== 'none') history.pushState(nextState, '', target.href);
      syncWorkspaceChrome(nextRoot, target.pathname);
      syncDrawer(Boolean(options.focusDrawer));
      closeMobileSidebar();
      restoreScroll(options.restoreState || nextState);
      const serverMs = Number(response.headers.get('x-prospect-server-ms') || nextRoot.dataset.prospectServerMs || 0);
      recordPerformance(kind, target, performance.now() - startedAt, serverMs);
      if (kind === 'workspace') {
        const heading = document.querySelector('.topbar-copy h1');
        if (heading instanceof HTMLElement) {
          heading.tabIndex = -1;
          heading.focus({ preventScroll: true });
        }
      }
    } catch (error) {
      if (error?.name === 'AbortError') return;
      if (options.fallbackToFullPage) {
        location.href = target.href;
        return;
      }
      showToast(error?.message || 'Workspace update failed.', 'error', retry);
    } finally {
      if (activeRequest === controller) {
        activeRequest = undefined;
        setLoading(false, kind);
      }
    }
  }

  function filterUrl(form) {
    const target = new URL(form.action || location.pathname, location.origin);
    const search = new URLSearchParams();
    for (const [key, value] of new FormData(form).entries()) {
      const normalized = String(value).trim();
      if (normalized) search.set(key, normalized);
    }
    search.set('page', '1');
    search.delete('leadId');
    target.search = search.toString();
    return target;
  }

  function submitFilter(form, historyMode = 'push') {
    navigate(filterUrl(form), { historyMode, preserveScroll: false, kind: 'filter' });
  }

  function closeDrawer() {
    if (history.state?.drawerEntry && history.length > 1) {
      history.back();
      return;
    }
    const target = new URL(location.href);
    target.searchParams.delete('leadId');
    navigate(target, { historyMode: 'replace', preserveScroll: true, kind: 'drawer' });
  }

  async function submitLeadAction(form, event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    const endpoint = form.dataset.endpoint;
    if (!endpoint) return;
    const button = form.querySelector('button[type=submit]');
    const originalLabel = button?.textContent || 'Save';
    if (button) {
      button.disabled = true;
      button.textContent = 'Saving…';
    }
    const payload = Object.fromEntries(new FormData(form).entries());
    if (endpoint.endsWith('/activity')) {
      const performedBy = String(payload.performedBy || '').trim();
      payload.body = `Team member: ${performedBy}\n${String(payload.body || '')}`;
      delete payload.performedBy;
    }
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || result.detail || 'Action failed');
      showToast(endpoint.includes('/guidance/') ? 'Guidance updated.' : 'Lead updated.');
      await navigate(location.href, { historyMode: 'replace', preserveScroll: true, focusDrawer: false, kind: 'drawer' });
    } catch (error) {
      showToast(error?.message || 'Action failed.', 'error');
      if (button) {
        button.disabled = false;
        button.textContent = originalLabel;
      }
    }
  }

  document.addEventListener('submit', (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    if (form.id === 'prospect-filter-form') {
      event.preventDefault();
      event.stopImmediatePropagation();
      submitFilter(form);
      return;
    }
    if (form.matches('[data-action-form]')) submitLeadAction(form, event);
  }, true);

  document.addEventListener('change', (event) => {
    const select = event.target;
    if (!(select instanceof HTMLSelectElement) || !select.closest('#prospect-filter-form')) return;
    event.stopImmediatePropagation();
    if (select.form) submitFilter(select.form);
  }, true);

  document.addEventListener('input', (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.id !== 'prospect-search') return;
    event.stopImmediatePropagation();
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      if (input.form) submitFilter(input.form, 'replace');
    }, 280);
  }, true);

  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest('.page-link.disabled')) {
      event.preventDefault();
      return;
    }
    if (target.closest('#prospect-drawer-close,#prospect-drawer-backdrop')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      closeDrawer();
      return;
    }
    const copyButton = target.closest('#copy-draft');
    if (copyButton) {
      event.preventDefault();
      event.stopImmediatePropagation();
      navigator.clipboard.writeText(document.getElementById('selected-draft')?.textContent || '').then(() => {
        copyButton.textContent = 'Copied';
        showToast('Message copied.');
      });
      return;
    }
    const anchor = target.closest('a');
    if (!(anchor instanceof HTMLAnchorElement) || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const isWorkspace = isRegisteredWorkspaceAnchor(anchor);
    const isLead = anchor.closest('.prospect-row') !== null;
    const isListNavigation = anchor.matches('.page-link,.metric-link,.clear-filters');
    if (!isWorkspace && !isLead && !isListNavigation) return;
    const destination = isWorkspace ? workspaceUrl(anchor) : new URL(anchor.href, location.href);
    if (destination.origin !== location.origin) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    navigate(destination, {
      historyMode: 'push',
      preserveScroll: isLead,
      focusDrawer: isLead,
      kind: isWorkspace ? 'workspace' : isLead ? 'drawer' : 'filter',
      fallbackToFullPage: isWorkspace,
    });
  }, true);

  window.addEventListener('popstate', (event) => navigate(location.href, {
    historyMode: 'none',
    restoreState: event.state || {},
    preserveScroll: true,
    kind: new URL(location.href).searchParams.has('leadId') ? 'drawer' : 'history',
  }));

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && document.body.classList.contains('drawer-open')) closeDrawer();
  });

  history.replaceState({ ...history.state, ...captureState(), drawerEntry: Boolean(history.state?.drawerEntry) }, '', location.href);
  syncSidebar(location.pathname);
  syncDrawer(false);
})();
