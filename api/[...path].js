const PREVIEW_PATH = '/api/preview';
const API_BASE = '/api';

const sampleLeads = [
  {
    id: 'preview-upwork-ai-rag',
    source: 'upwork',
    leadType: 'project',
    title: 'AI RAG chatbot for customer support portal',
    company: 'B2B SaaS founder',
    sourceUrl: 'https://www.upwork.com/jobs/preview-ai-rag-chatbot',
    capturedAt: new Date().toISOString(),
    budgetSignal: '$5k-$10k',
    timelineSignal: 'Immediate / this week',
    score: 91,
    status: 'qualified',
    pipelineStatus: 'new',
    owner: 'Unassigned',
    notes: '',
    redFlags: ['Needs human review before proposal submission', 'No automatic Upwork bidding enabled'],
    rawPayload: {
      source: 'sample',
      description: 'Client wants a RAG chatbot connected to help docs, with admin review and analytics.',
      budget: '$5k-$10k',
      timeline: 'ASAP',
    },
    draft: `Hi,\n\nWe can help build the RAG chatbot with a safe admin review workflow, source-grounded answers, analytics, and a clean support portal integration.\n\nFor a first step, I would suggest a short discovery call to confirm the knowledge sources, guardrails, and support handoff flow.\n\nBest,\nCodistan Team`,
  },
  {
    id: 'preview-linkedin-healthcare-crm',
    source: 'linkedin_sales_nav',
    leadType: 'account_signal',
    title: 'Healthcare CRM revamp and automation signal',
    company: 'Regional healthcare services group',
    sourceUrl: 'https://www.linkedin.com/sales/lead/preview-healthcare-crm',
    capturedAt: new Date().toISOString(),
    budgetSignal: 'Mid-market transformation signal',
    timelineSignal: 'Planning stage',
    score: 84,
    status: 'qualified',
    pipelineStatus: 'researching',
    owner: 'Unassigned',
    notes: '',
    redFlags: ['Business contact must be verified manually', 'No LinkedIn auto-DM enabled'],
    rawPayload: {
      source: 'sample',
      signal: 'Hiring and content activity suggests CRM modernization and workflow automation interest.',
      nextStep: 'Research account and prepare human-approved outreach angle.',
    },
    draft: `Hi,\n\nNoticed your team appears to be investing in digital operations and customer experience. Codistan helps teams modernize CRM workflows, patient/customer journeys, automation, and reporting without disrupting existing operations.\n\nHappy to share a few relevant examples if this is a current priority.\n\nBest,\nCodistan Team`,
  },
];

let leads = sampleLeads.map(cloneLead);

module.exports = async function handler(req, res) {
  try {
    const path = getPath(req);

    if (req.method === 'POST' && path.endsWith('/evaluate')) {
      const body = await readBody(req);
      const lead = createLead(body);
      leads = [lead, ...leads.filter((item) => item.id !== lead.id)];
      return sendJson(res, 200, { ok: true, lead });
    }

    if (req.method === 'POST' && path.endsWith('/dev/reset-local-data')) {
      leads = sampleLeads.map(cloneLead);
      return sendJson(res, 200, {
        ok: true,
        message: 'Preview demo data reset. No external account, Gmail, LinkedIn, Upwork, or CRM data was touched.',
      });
    }

    const leadUpdateMatch = path.match(/\/leads\/([^/]+)\/(status|owner|notes)$/);
    if (req.method === 'POST' && leadUpdateMatch) {
      const [, id, field] = leadUpdateMatch;
      const body = await readBody(req);
      const lead = leads.find((item) => item.id === id);
      if (!lead) return sendJson(res, 404, { ok: false, message: 'Lead not found' });
      if (field === 'status') lead.pipelineStatus = String(body.pipelineStatus || lead.pipelineStatus);
      if (field === 'owner') lead.owner = String(body.owner || lead.owner || 'Unassigned');
      if (field === 'notes') lead.notes = String(body.notes || '');
      return sendJson(res, 200, { ok: true, lead });
    }

    return sendHtml(res, renderDashboard(req));
  } catch (error) {
    return sendHtml(
      res,
      `<h1>Preview error</h1><pre>${escapeHtml(error && error.stack ? error.stack : String(error))}</pre>`,
      500,
    );
  }
};

function renderDashboard(req) {
  const url = new URL(req.url || PREVIEW_PATH, 'https://preview.codistan.local');
  const query = (url.searchParams.get('query') || '').toLowerCase();
  const status = url.searchParams.get('status') || '';
  const selectedId = url.searchParams.get('leadId') || leads[0]?.id;
  const filtered = leads.filter((lead) => {
    const matchesQuery = !query || `${lead.title} ${lead.company} ${lead.source}`.toLowerCase().includes(query);
    const matchesStatus = !status || lead.pipelineStatus === status;
    return matchesQuery && matchesStatus;
  });
  const selected = leads.find((lead) => lead.id === selectedId) || filtered[0] || leads[0];

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Codistan Lead Desk Preview</title>
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #f5f7fb; color: #111827; }
    header { padding: 28px; background: #0f172a; color: white; }
    header p { max-width: 980px; color: #cbd5e1; line-height: 1.55; }
    main { display: grid; grid-template-columns: minmax(320px, 430px) 1fr; gap: 20px; padding: 20px; }
    section, .card { background: white; border: 1px solid #e5e7eb; border-radius: 18px; box-shadow: 0 12px 30px rgba(15, 23, 42, .06); }
    section { padding: 18px; }
    h1, h2, h3 { margin-top: 0; }
    .toolbar { display: grid; gap: 12px; margin-bottom: 16px; }
    .toolbar form { display: grid; grid-template-columns: 1fr 150px auto; gap: 10px; }
    input, select, textarea { border: 1px solid #d1d5db; border-radius: 10px; padding: 10px 12px; font: inherit; }
    textarea { min-height: 92px; width: 100%; box-sizing: border-box; }
    button, .button { border: 0; border-radius: 999px; padding: 10px 14px; font-weight: 700; cursor: pointer; background: #2563eb; color: white; text-decoration: none; display: inline-flex; align-items: center; justify-content: center; gap: 8px; }
    button.secondary, .button.secondary { background: #e0f2fe; color: #075985; }
    button.danger { background: #fee2e2; color: #991b1b; }
    button:disabled { cursor: wait; opacity: .7; }
    .safe { background: #ecfdf5; border: 1px solid #a7f3d0; color: #047857; padding: 12px; border-radius: 14px; }
    .notice { display: none; border-radius: 12px; padding: 10px 12px; margin: 10px 0; font-size: 14px; }
    .notice.error { display: block; background: #fee2e2; color: #991b1b; border: 1px solid #fecaca; }
    .notice.success { display: block; background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0; }
    .card { padding: 14px; margin-bottom: 12px; }
    .card.active { border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37, 99, 235, .12); }
    .meta { color: #64748b; font-size: 13px; line-height: 1.5; }
    .score { font-size: 30px; font-weight: 800; color: #16a34a; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .panel { border: 1px solid #e5e7eb; border-radius: 14px; padding: 14px; margin: 12px 0; background: #fbfdff; }
    pre { white-space: pre-wrap; background: #0f172a; color: #e2e8f0; border-radius: 14px; padding: 14px; overflow: auto; }
    .redflag { background: #fff7ed; color: #9a3412; border: 1px solid #fed7aa; padding: 8px 10px; border-radius: 999px; display: inline-block; margin: 4px 4px 4px 0; font-size: 13px; }
    @media (max-width: 900px) { main { grid-template-columns: 1fr; } .toolbar form { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
<header>
  <h1>Codistan Lead Desk — Hosted Preview</h1>
  <p>This is a dependency-free Vercel preview for browser review. It demonstrates manual lead intake, scoring view, source evidence, human-approved draft copy, filters, owner/status/notes, and safe reset. No scraping, auto-bidding, auto-DM, Gmail modification, or sending is connected.</p>
</header>
<main>
  <section>
    <div class="safe"><strong>Safe preview mode:</strong> demo-only memory data. External accounts are not touched.</div>
    <div id="preview-notice" class="notice"></div>
    <div class="toolbar">
      <h2>Evaluate sample lead</h2>
      <button type="button" class="secondary" onclick="evaluateSample('upwork', this)">Add Upwork sample</button>
      <button type="button" class="secondary" onclick="evaluateSample('linkedin', this)">Add LinkedIn sample</button>
      <button type="button" class="danger" onclick="resetData(this)">Reset preview data</button>
      <form method="GET" action="${PREVIEW_PATH}">
        <input name="query" placeholder="Search title, company, source" value="${escapeHtml(url.searchParams.get('query') || '')}" />
        <select name="status">
          ${statusOption('', 'All statuses', status)}
          ${statusOption('new', 'New', status)}
          ${statusOption('researching', 'Researching', status)}
          ${statusOption('contact_ready', 'Contact ready', status)}
          ${statusOption('archived', 'Archived', status)}
        </select>
        <button type="submit">Filter</button>
      </form>
    </div>
    <h2>Opportunities</h2>
    ${filtered.length ? filtered.map((lead) => renderLeadCard(lead, selected?.id, url)).join('') : '<p class="meta">No leads match the current filter.</p>'}
  </section>
  <section>
    ${selected ? renderLeadDetail(selected) : '<h2>No lead selected</h2>'}
  </section>
</main>
<script>
  const PREVIEW_PATH = '${PREVIEW_PATH}';
  const API_BASE = '${API_BASE}';

  async function evaluateSample(kind, button) {
    try {
      setBusy(button, true);
      const data = await postJson(API_BASE + '/evaluate', { kind });
      window.location.assign(PREVIEW_PATH + '?leadId=' + encodeURIComponent(data.lead.id));
    } catch (error) {
      showNotice(error.message || 'Could not add sample lead.', 'error');
      setBusy(button, false);
    }
  }

  async function resetData(button) {
    if (!confirm('Reset demo preview data? No external system will be touched.')) return;
    try {
      setBusy(button, true);
      await postJson(API_BASE + '/dev/reset-local-data');
      window.location.assign(PREVIEW_PATH);
    } catch (error) {
      showNotice(error.message || 'Could not reset preview data.', 'error');
      setBusy(button, false);
    }
  }

  async function updateLead(id, field, button) {
    const element = document.querySelector('[data-field="' + field + '"]');
    const body = {};
    body[field === 'status' ? 'pipelineStatus' : field] = element.value;
    try {
      setBusy(button, true);
      await postJson(API_BASE + '/leads/' + encodeURIComponent(id) + '/' + field, body);
      showNotice(field + ' saved. Preview data is in-memory only.', 'success');
      setTimeout(() => window.location.assign(window.location.pathname + window.location.search), 350);
    } catch (error) {
      showNotice(error.message || 'Could not save ' + field + '.', 'error');
      setBusy(button, false);
    }
  }

  async function copyDraft() {
    const draft = document.getElementById('draft').innerText;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(draft);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = draft;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        textarea.remove();
      }
      document.getElementById('copy-result').innerText = 'Draft copied for manual review. Nothing was sent automatically.';
    } catch (error) {
      document.getElementById('copy-result').innerText = 'Could not copy automatically. Please select and copy the draft manually.';
    }
  }

  async function postJson(path, body) {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-codistan-session': 'dev-founder-token' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    let data = {};
    try { data = await response.json(); } catch {}
    if (!response.ok || data.ok === false) {
      throw new Error(data.message || 'Request failed with status ' + response.status);
    }
    return data;
  }

  function setBusy(button, isBusy) {
    if (!button) return;
    button.disabled = isBusy;
  }

  function showNotice(message, type) {
    const notice = document.getElementById('preview-notice');
    if (!notice) return;
    notice.className = 'notice ' + (type || 'success');
    notice.innerText = message;
  }
</script>
</body>
</html>`;
}

function renderLeadCard(lead, selectedId, url) {
  const params = new URLSearchParams(url.searchParams);
  params.set('leadId', lead.id);
  return `<a class="card ${lead.id === selectedId ? 'active' : ''}" href="${PREVIEW_PATH}?${params.toString()}" style="display:block;color:inherit;text-decoration:none">
    <div class="meta">${escapeHtml(lead.source)} • ${escapeHtml(lead.pipelineStatus)} • ${escapeHtml(lead.budgetSignal)}</div>
    <h3>${escapeHtml(lead.title)}</h3>
    <div class="meta">${escapeHtml(lead.company)}</div>
    <div class="score">${lead.score}</div>
  </a>`;
}

function renderLeadDetail(lead) {
  return `<h2>${escapeHtml(lead.title)}</h2>
  <p class="meta">${escapeHtml(lead.company)} • ${escapeHtml(lead.status)} • Score ${lead.score}</p>
  <div class="grid">
    <div class="panel"><strong>Source</strong><br>${escapeHtml(lead.source)}</div>
    <div class="panel"><strong>Lead Type</strong><br>${escapeHtml(lead.leadType)}</div>
    <div class="panel"><strong>Budget Signal</strong><br>${escapeHtml(lead.budgetSignal)}</div>
    <div class="panel"><strong>Timeline Signal</strong><br>${escapeHtml(lead.timelineSignal)}</div>
  </div>
  <div class="panel">
    <h3>Review controls</h3>
    <label>Status</label><br>
    <select data-field="status">
      ${statusOption('new', 'New', lead.pipelineStatus)}
      ${statusOption('researching', 'Researching', lead.pipelineStatus)}
      ${statusOption('contact_ready', 'Contact ready', lead.pipelineStatus)}
      ${statusOption('archived', 'Archived', lead.pipelineStatus)}
    </select>
    <button type="button" onclick="updateLead('${lead.id}', 'status', this)">Save status</button>
    <br><br>
    <label>Owner</label><br>
    <input data-field="owner" value="${escapeHtml(lead.owner || '')}" />
    <button type="button" onclick="updateLead('${lead.id}', 'owner', this)">Save owner</button>
    <br><br>
    <label>Notes</label><br>
    <textarea data-field="notes">${escapeHtml(lead.notes || '')}</textarea>
    <button type="button" onclick="updateLead('${lead.id}', 'notes', this)">Save notes</button>
  </div>
  <div class="panel">
    <h3>Source Evidence</h3>
    <p><strong>Captured:</strong> ${escapeHtml(lead.capturedAt)}</p>
    <p><strong>Source URL:</strong> <a href="${escapeAttr(lead.sourceUrl)}" target="_blank" rel="noreferrer">${escapeHtml(lead.sourceUrl)}</a></p>
    <pre>${escapeHtml(JSON.stringify(lead.rawPayload, null, 2))}</pre>
  </div>
  <div class="panel">
    <h3>Safety flags</h3>
    ${lead.redFlags.map((flag) => `<span class="redflag">${escapeHtml(flag)}</span>`).join('')}
  </div>
  <div class="panel">
    <h3>Human-approved draft</h3>
    <pre id="draft">${escapeHtml(lead.draft)}</pre>
    <button type="button" onclick="copyDraft()">Copy draft for manual review</button>
    <p id="copy-result" class="meta"></p>
  </div>`;
}

function createLead(body) {
  const kind = body && body.kind === 'linkedin' ? 'linkedin' : 'upwork';
  const base = kind === 'linkedin' ? sampleLeads[1] : sampleLeads[0];
  return {
    ...cloneLead(base),
    id: `${base.id}-${Date.now()}`,
    capturedAt: new Date().toISOString(),
  };
}

function cloneLead(lead) {
  return JSON.parse(JSON.stringify(lead));
}

function statusOption(value, label, selected) {
  return `<option value="${escapeAttr(value)}" ${value === selected ? 'selected' : ''}>${escapeHtml(label)}</option>`;
}

function getPath(req) {
  return new URL(req.url || PREVIEW_PATH, 'https://preview.codistan.local').pathname;
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return Object.fromEntries(new URLSearchParams(raw)); }
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function sendHtml(res, body, status = 200) {
  res.statusCode = status;
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(body);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}
