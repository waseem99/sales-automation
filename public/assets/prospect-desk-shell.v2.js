(() => {
  const sidebar = document.getElementById('workspace-sidebar');
  const toggle = document.getElementById('sidebar-toggle');
  const closeButton = document.getElementById('sidebar-close');
  const logoutButton = document.getElementById('logout-button');
  const storageKey = 'prospect-desk-nav-groups-v1';

  function closeSidebar() {
    sidebar?.classList.remove('is-open');
    toggle?.setAttribute('aria-expanded', 'false');
    document.querySelector('.workspace-sidebar-backdrop')?.remove();
    document.body.classList.remove('nav-open');
  }

  function openSidebar() {
    if (!sidebar) return;
    sidebar.classList.add('is-open');
    toggle?.setAttribute('aria-expanded', 'true');
    document.body.classList.add('nav-open');
    if (!document.querySelector('.workspace-sidebar-backdrop')) {
      const backdrop = document.createElement('button');
      backdrop.type = 'button';
      backdrop.className = 'workspace-sidebar-backdrop';
      backdrop.setAttribute('aria-label', 'Close navigation');
      backdrop.addEventListener('click', closeSidebar);
      document.body.append(backdrop);
    }
    closeButton?.focus({ preventScroll: true });
  }

  toggle?.addEventListener('click', () => {
    if (sidebar?.classList.contains('is-open')) closeSidebar(); else openSidebar();
  });
  closeButton?.addEventListener('click', closeSidebar);
  window.addEventListener('resize', () => { if (window.innerWidth > 1080) closeSidebar(); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeSidebar(); });
  sidebar?.querySelectorAll('a').forEach((link) => link.addEventListener('click', closeSidebar));

  logoutButton?.addEventListener('click', async (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    logoutButton.disabled = true;
    logoutButton.textContent = 'Signing out…';
    try {
      await fetch('/api/logout', { method: 'POST', headers: { accept: 'application/json' } });
    } finally {
      location.href = '/login';
    }
  }, { capture: true });

  let remembered = {};
  try { remembered = JSON.parse(localStorage.getItem(storageKey) || '{}'); } catch { remembered = {}; }
  const groups = [...document.querySelectorAll('[data-nav-group]')];
  for (const group of groups) {
    const id = group.getAttribute('data-nav-group');
    if (!id) continue;
    const hasActivePage = Boolean(group.querySelector('[aria-current="page"]'));
    if (!hasActivePage && typeof remembered[id] === 'boolean') group.open = remembered[id];
    group.addEventListener('toggle', () => {
      let current = {};
      try { current = JSON.parse(localStorage.getItem(storageKey) || '{}'); } catch { current = {}; }
      current[id] = group.open;
      localStorage.setItem(storageKey, JSON.stringify(current));
    });
  }

  const active = document.querySelector('.nav-item[aria-current="page"]');
  active?.scrollIntoView({ block: 'nearest' });
})();
