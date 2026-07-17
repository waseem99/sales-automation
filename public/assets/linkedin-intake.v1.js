(() => {
  'use strict';

  const form = document.getElementById('linkedin-research-form');
  const result = document.getElementById('linkedin-research-result');
  if (!(form instanceof HTMLFormElement) || !(result instanceof HTMLElement)) return;

  const submit = form.querySelector('button[type="submit"]');

  function show(message, state = '') {
    result.replaceChildren();
    result.className = `form-result wide${state ? ` ${state}` : ''}`;
    const text = document.createElement('span');
    text.textContent = message;
    result.append(text);
  }

  function addLink(href, label) {
    const link = document.createElement('a');
    link.href = href;
    link.textContent = label;
    link.style.marginLeft = '8px';
    result.append(link);
  }

  function validLinkedInUrl(value) {
    try {
      const url = new URL(value);
      if (!['linkedin.com', 'www.linkedin.com'].includes(url.hostname.toLowerCase())) return false;
      return /^\/(?:in|company|posts|feed\/update)\//i.test(url.pathname);
    } catch (_error) {
      return false;
    }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    if (!validLinkedInUrl(String(data.sourceUrl || ''))) {
      show('Use a LinkedIn profile, company or post URL.', 'error');
      return;
    }

    if (submit instanceof HTMLButtonElement) submit.disabled = true;
    show('Saving, checking duplicates and preparing the research record…');

    try {
      const response = await fetch(form.action, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'accept': 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify(data),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `Prospect Desk returned ${response.status}.`);

      const created = Number(payload.created || 0);
      const duplicates = Number(payload.duplicates || 0);
      const message = created > 0
        ? 'LinkedIn prospect added for research, qualification and human review.'
        : duplicates > 0
          ? 'This LinkedIn prospect already exists; no duplicate was created.'
          : 'The intake completed without creating a new record.';
      show(message, 'success');
      if (typeof payload.prospectUrl === 'string' && payload.prospectUrl.startsWith('/prospects')) {
        addLink(payload.prospectUrl, 'Open prospect');
      }
      if (created > 0) form.reset();
    } catch (error) {
      show(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      if (submit instanceof HTMLButtonElement) submit.disabled = false;
    }
  });
})();
