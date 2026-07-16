(() => {
  const DENSITY_KEY = 'prospect-workflow-density-v1';
  const SORT_KEY = 'prospect-workflow-sort-v1';
  const LAST_VISIT_KEY = 'prospect-workflow-last-visit-v1';
  const previousVisit = localStorage.getItem(LAST_VISIT_KEY) || new Date().toISOString();

  function applyDensity(value) {
    const density = value === 'compact' ? 'compact' : 'comfortable';
    document.body.classList.toggle('workflow-density-compact', density === 'compact');
    document.querySelectorAll('[data-workflow-density]').forEach((button) => {
      const active = button.getAttribute('data-workflow-density') === density;
      button.setAttribute('aria-pressed', String(active));
      button.classList.toggle('active', active);
    });
    localStorage.setItem(DENSITY_KEY, density);
  }

  function comparable(row, key) {
    if (key === 'score') return Number(row.dataset.score || -1);
    if (key === 'followup') return Number(row.dataset.followUp || Number.MAX_SAFE_INTEGER);
    if (key === 'updated') return Number(row.dataset.updated || 0);
    return row.querySelector('.workflow-opportunity strong')?.textContent?.trim().toLowerCase() || '';
  }

  function sortRows(key, direction) {
    const tbody = document.getElementById('prospect-rows');
    if (!tbody) return;
    const rows = [...tbody.querySelectorAll('.prospect-row')];
    const multiplier = direction === 'asc' ? 1 : -1;
    rows.sort((left, right) => {
      const a = comparable(left, key);
      const b = comparable(right, key);
      if (typeof a === 'number' && typeof b === 'number') return (a - b) * multiplier;
      return String(a).localeCompare(String(b)) * multiplier;
    });
    rows.forEach((row) => tbody.append(row));
    document.querySelectorAll('[data-workflow-sort]').forEach((button) => {
      const active = button.getAttribute('data-workflow-sort') === key;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
      button.closest('th')?.setAttribute('aria-sort', active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none');
    });
    sessionStorage.setItem(SORT_KEY, JSON.stringify({ key, direction }));
  }

  function restoreSort() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(SORT_KEY) || 'null');
      if (saved?.key && saved?.direction) sortRows(saved.key, saved.direction);
    } catch {
      sessionStorage.removeItem(SORT_KEY);
    }
  }

  function markNewRows() {
    const previous = Date.parse(previousVisit);
    if (!Number.isFinite(previous)) return;
    document.querySelectorAll('.prospect-row[data-created-at]').forEach((row) => {
      const created = Date.parse(row.getAttribute('data-created-at') || '');
      const indicator = row.querySelector('[data-new-indicator]');
      if (indicator instanceof HTMLElement) indicator.hidden = !(Number.isFinite(created) && created > previous);
    });
  }

  function initializeWorkflow() {
    applyDensity(localStorage.getItem(DENSITY_KEY) || 'comfortable');
    markNewRows();
    restoreSort();
  }

  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const densityButton = target.closest('[data-workflow-density]');
    if (densityButton instanceof HTMLButtonElement) {
      event.preventDefault();
      applyDensity(densityButton.dataset.workflowDensity);
      return;
    }
    const sortButton = target.closest('[data-workflow-sort]');
    if (sortButton instanceof HTMLButtonElement) {
      event.preventDefault();
      const key = sortButton.dataset.workflowSort || 'score';
      let direction = key === 'followup' ? 'asc' : 'desc';
      try {
        const saved = JSON.parse(sessionStorage.getItem(SORT_KEY) || 'null');
        if (saved?.key === key) direction = saved.direction === 'asc' ? 'desc' : 'asc';
      } catch {}
      sortRows(key, direction);
    }
  }, true);

  window.addEventListener('prospect:partial-performance', initializeWorkflow);
  window.addEventListener('pagehide', () => localStorage.setItem(LAST_VISIT_KEY, new Date().toISOString()));
  initializeWorkflow();
})();
