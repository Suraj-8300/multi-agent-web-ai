// ═══════════════════════════════════════════════════════════════════════
// WebIntel — Main Application Controller  v2.0.0
// Standalone frontend — uses CONFIG.API_BASE from config.js
// ═══════════════════════════════════════════════════════════════════════

const API = CONFIG.API_BASE;

// ─── Application State ────────────────────────────────────────────────
const state = {
  sessionId:      null,
  eventSource:    null,
  running:        false,
  currentReport:  null,
  claimsCount:    0,
  sourcesCount:   0,
  conflictsCount: 0,
  resolvedCount:  0,
  chartInstance:  null,
  chartData:      { labels: [], agreements: [], conflicts: [] },
  seenDomains:    new Set(),
  progress:       0,
};

// ─── DOM Refs (cached once) ────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const DOM = {
  queryInput:      () => $('query-input'),
  modeSelect:      () => $('mode-select'),
  typeSelect:      () => $('type-select'),
  entitiesInput:   () => $('entities-input'),
  urlInput:        () => $('url-input'),
  btnRun:          () => $('btn-run'),
  btnRunLabel:     () => $('btn-run-label'),
  btnRunIcon:      () => $('btn-run-icon'),
  statusDot:       () => $('status-dot'),
  statusText:      () => $('status-text'),
  statusPill:      () => $('status-pill'),
  traceList:       () => $('trace-list'),
  traceCount:      () => $('trace-count'),
  claimsList:      () => $('claims-list'),
  claimsCount:     () => $('claims-count'),
  sourcesList:     () => $('sources-list'),
  sourcesCount:    () => $('sources-count'),
  conflictList:    () => $('conflict-list'),
  conflictCount:   () => $('conflict-count'),
  progressBar:     () => $('progress-bar'),
  statsBar:        () => $('stats-bar'),
  mainPanel:       () => $('main-panel'),
  bottomRow:       () => $('bottom-row'),
  reportSummary:   () => $('report-summary'),
  centerTitle:     () => $('center-panel-title'),
  statSources:     () => $('stat-sources'),
  statClaims:      () => $('stat-claims'),
  statConflicts:   () => $('stat-conflicts'),
  statResolved:    () => $('stat-resolved'),
  statConfidence:  () => $('stat-confidence'),
  sumConfidence:   () => $('sum-confidence'),
  sumClaims:       () => $('sum-claims'),
  sumSources:      () => $('sum-sources'),
  sumConflicts:    () => $('sum-conflicts'),
  summaryQuery:    () => $('summary-query-text'),
  historySidebar:  () => $('history-sidebar'),
  historyList:     () => $('history-list'),
  overlay:         () => $('overlay'),
  toastContainer:  () => $('toast-container'),
};

// ─── Demo Quick-fill ───────────────────────────────────────────────────
function setDemo(query, mode, type, entities = '') {
  DOM.queryInput().value = query;
  DOM.modeSelect().value = mode;
  DOM.typeSelect().value = type;
  handleTypeChange();
  if (entities) DOM.entitiesInput().value = entities;
  DOM.queryInput().focus();
}

// ─── Query Type Change ─────────────────────────────────────────────────
function handleTypeChange() {
  const type = DOM.typeSelect().value;
  $('entities-row').classList.toggle('visible', type === 'compare');
  $('url-input-row').classList.toggle('visible', type === 'summarise_url');
  DOM.centerTitle().textContent =
    type === 'compare' ? 'Comparison Table'
    : type === 'track' ? 'Changes Detected'
    : 'Verified Claims';
}

// ─── Start Query ───────────────────────────────────────────────────────
async function startQuery() {
  const query = DOM.queryInput().value.trim();
  if (!query) { showToast('Please enter a research query.', 'error'); return; }
  if (state.running) { showToast('A research session is already running.', 'info'); return; }

  const mode     = DOM.modeSelect().value;
  const type     = DOM.typeSelect().value;
  const rawEnts  = DOM.entitiesInput().value;
  const url      = DOM.urlInput().value.trim();

  const entities = type === 'compare'
    ? rawEnts.split(',').map(e => e.trim()).filter(Boolean)
    : undefined;

  if (type === 'compare' && (!entities || entities.length < 2)) {
    showToast('Enter at least 2 entities to compare (comma-separated).', 'error');
    return;
  }
  if (type === 'summarise_url' && !url) {
    showToast('Please enter a URL to summarise.', 'error');
    return;
  }

  const body = { query, mode, query_type: type };
  if (entities?.length) body.entities = entities;
  if (url) body.url = url;

  resetUI(query, type);

  try {
    const resp = await fetch(`${API}/api/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!resp.ok) throw new Error(`Server error: ${resp.status}`);
    const data = await resp.json();
    state.sessionId = data.session_id;
    connectSSE(data.session_id);
  } catch (err) {
    showToast(`Failed to start: ${err.message}`, 'error');
    setIdle();
  }
}

// ─── SSE Connection ────────────────────────────────────────────────────
function connectSSE(sessionId) {
  if (state.eventSource) state.eventSource.close();

  const es = new EventSource(`${API}/api/stream/${sessionId}`);
  state.eventSource = es;

  es.addEventListener('trace',  e => handleTrace(parseEvent(e)));
  es.addEventListener('claim',  e => handleClaim(parseEvent(e)));
  es.addEventListener('report', e => handleReport(parseEvent(e)));
  es.addEventListener('error',  e => handleStreamError(parseEvent(e)));
  es.addEventListener('done',   e => handleDone(parseEvent(e)));
  es.addEventListener('ping',   () => {});  // keep-alive

  es.onerror = () => {
    if (state.running) {
      showToast('Connection interrupted. Retrying…', 'info');
    }
  };
}

function parseEvent(e) {
  try { return JSON.parse(e.data); }
  catch { return {}; }
}

// ─── SSE Event Handlers ────────────────────────────────────────────────
function handleTrace(data) {
  const list = DOM.traceList();
  clearEmpty(list);

  // Mark previous active dots as done
  list.querySelectorAll('.trace-dot.active').forEach(d => {
    d.classList.remove('active');
    d.classList.add('done');
  });

  const step = document.createElement('div');
  step.className = 'trace-step';
  const time = data.timestamp
    ? new Date(data.timestamp).toLocaleTimeString('en', { hour12: false })
    : new Date().toLocaleTimeString('en', { hour12: false });

  step.innerHTML = `
    <div class="trace-rail">
      <div class="trace-dot active"></div>
      <div class="trace-line"></div>
    </div>
    <div class="trace-body">
      <div class="trace-msg">${escHtml(data.message || '')}</div>
      <div class="trace-time">${time}</div>
    </div>
  `;
  list.appendChild(step);
  list.scrollTop = list.scrollHeight;

  const cnt = list.querySelectorAll('.trace-step').length;
  setCount('trace-count', cnt);

  // Update progress (approximate based on 8 typical trace steps)
  advanceProgress(Math.min(90, cnt * 11));
}

function handleClaim(claim) {
  const list = DOM.claimsList();
  clearEmpty(list);

  state.claimsCount++;
  setCount('claims-count', state.claimsCount);
  DOM.statClaims().textContent = state.claimsCount;

  // Conflicts
  const hasConflict = claim.conflicting_sources?.length > 0;
  if (hasConflict) {
    state.conflictsCount++;
    DOM.statConflicts().textContent = state.conflictsCount;
    setCount('conflict-count', state.conflictsCount);
    $('sp-conflicts').classList.add('active');
    if (claim.status === 'verified') {
      state.resolvedCount++;
      DOM.statResolved().textContent = state.resolvedCount;
    }
    renderConflict(claim);
  }

  const pct = Math.round((claim.confidence_score || 0) * 100);
  const fillClass = pct >= 70 ? 'conf-high' : pct >= 45 ? 'conf-mid' : 'conf-low';
  const statusMap = {
    verified:   'badge-verified',
    conflict:   'badge-conflict',
    unresolved: 'badge-unresolved',
    pending:    'badge-pending',
  };
  const badgeCls = statusMap[claim.status] || 'badge-pending';

  const card = document.createElement('article');
  card.className = `claim-card status-${claim.status || 'pending'}`;
  card.setAttribute('aria-label', 'Verified claim');
  card.innerHTML = `
    <div class="claim-statement">${escHtml(claim.statement)}</div>
    <div class="claim-footer">
      <div class="conf-track" title="${pct}% confidence">
        <div class="conf-fill ${fillClass}" style="width:${pct}%"></div>
      </div>
      <span class="conf-pct">${pct}%</span>
      <span class="badge ${badgeCls}">${claim.status || 'pending'}</span>
      ${claim.supporting_sources?.length
        ? `<span style="font-size:10.5px;color:var(--text-3)">${claim.supporting_sources.length} src</span>`
        : ''}
    </div>
  `;
  list.appendChild(card);
  list.scrollTop = list.scrollHeight;

  // Update sources panel
  claim.supporting_sources?.forEach(u => addSource(u, false));
  claim.conflicting_sources?.forEach(u => addSource(u, true));
}

function handleReport(report) {
  state.currentReport = report;
  advanceProgress(100);

  const conf = Math.round(report.overall_confidence || 0);
  DOM.sumConfidence().textContent = `${conf}%`;
  DOM.sumClaims().textContent     = report.verified_claims?.length || 0;
  DOM.sumSources().textContent    = report.sources?.length || 0;
  DOM.sumConflicts().textContent  = report.conflicts_detected || 0;
  DOM.statConfidence().textContent = `${conf}%`;
  DOM.summaryQuery().textContent  = report.query;

  // Update sources from full report data (fills in trust info)
  if (report.sources?.length) {
    const sourcesList = DOM.sourcesList();
    // Only clear if mostly empty (< 3 items)
    if (sourcesList.querySelectorAll('.source-item').length < 3) {
      sourcesList.innerHTML = '';
    }
    report.sources.forEach(s => renderSourceFromReport(s));
  }

  // Compare table
  if (report.compare_table?.length) {
    DOM.centerTitle().textContent = 'Comparison Table';
    renderCompareTable(report.compare_table, DOM.claimsList());
  }

  // Track diff
  if (report.diff?.length) {
    DOM.centerTitle().textContent = 'Changes Detected';
    renderDiff(report.diff, DOM.claimsList());
  }

  // Show summary sections
  DOM.bottomRow().classList.add('visible');
  DOM.reportSummary().classList.add('visible');
  $('btn-export-json').dataset.session = report.session_id;
}

function handleStreamError(data) {
  showToast(`❌ ${data.message || 'Pipeline error occurred'}`, 'error');
}

function handleDone() {
  // Mark all active trace dots as done
  document.querySelectorAll('.trace-dot.active').forEach(d => {
    d.classList.remove('active');
    d.classList.add('done');
  });
  setIdle();
  showToast('Research complete! 🎉', 'success');
}

// ─── Source Rendering ──────────────────────────────────────────────────
function addSource(url, isConflict) {
  const domain = extractDomain(url);
  const list   = DOM.sourcesList();

  const existing = list.querySelector(`[data-domain="${CSS.escape(domain)}"]`);
  if (existing) {
    const agEl = existing.querySelector('.src-agree-val');
    const cfEl = existing.querySelector('.src-conflict-val');
    if (!isConflict && agEl) agEl.textContent = parseInt(agEl.textContent || 0) + 1;
    if (isConflict  && cfEl) cfEl.textContent = parseInt(cfEl.textContent || 0) + 1;
    updateChart(domain, isConflict ? 0 : 1, isConflict ? 1 : 0);
    return;
  }

  clearEmpty(list);
  state.sourcesCount++;
  DOM.sourcesCount().textContent = state.sourcesCount;
  DOM.statSources().textContent  = state.sourcesCount;

  const { tier, score } = getTrustInfo(domain);
  const item = buildSourceItem(domain, url, tier, score, isConflict ? 0 : 1, isConflict ? 1 : 0);
  list.appendChild(item);
  updateChart(domain, isConflict ? 0 : 1, isConflict ? 1 : 0);
}

function renderSourceFromReport(s) {
  const list   = DOM.sourcesList();
  const domain = s.domain || extractDomain(s.url);
  if (list.querySelector(`[data-domain="${CSS.escape(domain)}"]`)) return;

  clearEmpty(list);
  const item = buildSourceItem(domain, s.url, s.trust_tier || 'unknown', s.trust_score || 45, s.agreement_count || 0, s.conflict_count || 0, s.discarded);
  list.appendChild(item);
}

function buildSourceItem(domain, url, tier, score, agree, conflict, discarded = false) {
  const item = document.createElement('div');
  item.className = `source-item${discarded ? ' discarded' : ''}`;
  item.setAttribute('data-domain', domain);
  item.setAttribute('role', 'listitem');
  item.setAttribute('title', discarded ? 'Discarded: trust score too low' : url);

  const faviconLetter = getFaviconLetter(domain);
  const badgeCls = `badge badge-${tier}`;

  item.innerHTML = `
    <div class="source-favicon trust-${tier}" aria-hidden="true" title="${tier} trust">${faviconLetter}</div>
    <div class="source-info">
      <div class="source-domain">${escHtml(domain)}</div>
      <div class="source-url">${escHtml(url.substring(0, 55))}${url.length > 55 ? '…' : ''}</div>
      <div class="source-stats">
        <span class="src-stat src-agree" title="Agreements">✅ <span class="src-agree-val">${agree}</span></span>
        <span class="src-stat src-conflict" title="Conflicts">⚔️ <span class="src-conflict-val">${conflict}</span></span>
        <span class="badge ${badgeCls}" style="margin-left:4px">${tier} · ${score}</span>
        ${discarded ? '<span style="font-size:10px;color:var(--red);margin-left:4px">discarded</span>' : ''}
      </div>
    </div>
  `;
  return item;
}

function getFaviconLetter(domain) {
  return (domain || '?').charAt(0).toUpperCase();
}

// ─── Conflict Rendering ────────────────────────────────────────────────
function renderConflict(claim) {
  const list = DOM.conflictList();
  clearEmpty(list);

  const item = document.createElement('div');
  item.className = 'conflict-item';
  item.innerHTML = `
    <div class="conflict-claim">${escHtml(claim.statement.substring(0, 130))}${claim.statement.length > 130 ? '…' : ''}</div>
    <div class="conflict-detail">⚠️ ${escHtml(claim.conflict_detail || 'Sources disagree on this claim')}</div>
    ${claim.resolution_method
      ? `<div class="conflict-resolution">✅ Resolved via ${formatResolution(claim.resolution_method)}</div>`
      : ''}
  `;
  list.appendChild(item);
}

// ─── Compare Table ─────────────────────────────────────────────────────
function renderCompareTable(rows, container) {
  if (!rows?.length) return;
  const entities = [...new Set(rows.flatMap(r => r.cells?.map(c => c.entity) || []))];

  let html = `
    <div style="overflow-x:auto">
    <table class="compare-table">
      <thead>
        <tr>
          <th>Criterion</th>
          ${entities.map(e => `<th>${escHtml(e)}</th>`).join('')}
        </tr>
      </thead>
      <tbody>
  `;
  rows.forEach(row => {
    html += `<tr><td>${escHtml(row.criterion)}</td>`;
    entities.forEach(entity => {
      const cell = row.cells?.find(c => c.entity === entity);
      const conf = cell ? Math.round((cell.confidence || 0) * 100) : 0;
      const fillClass = conf >= 70 ? 'conf-high' : conf >= 45 ? 'conf-mid' : 'conf-low';
      html += `
        <td>
          <div>${cell ? escHtml(cell.value) : '—'}</div>
          ${cell ? `
            <div style="margin-top:6px;display:flex;align-items:center;gap:6px">
              <div class="conf-track" style="width:60px">
                <div class="conf-fill ${fillClass}" style="width:${conf}%"></div>
              </div>
              <span class="cmp-conf">${conf}%</span>
            </div>
          ` : ''}
        </td>
      `;
    });
    html += '</tr>';
  });
  html += '</tbody></table></div>';
  container.innerHTML = html;
}

// ─── Diff Render (track mode) ──────────────────────────────────────────
function renderDiff(diffs, container) {
  container.innerHTML = '';
  if (!diffs?.length) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">✅</div><span>No changes detected since last run</span></div>';
    return;
  }
  diffs.forEach(d => {
    const item = document.createElement('div');
    item.className = `diff-item diff-${d.type}`;
    const confText = d.old_confidence != null && d.new_confidence != null
      ? ` · ${Math.round(d.old_confidence * 100)}% → ${Math.round(d.new_confidence * 100)}%`
      : '';
    item.innerHTML = `<div class="diff-label">${d.type}${confText}</div><div>${escHtml(d.claim)}</div>`;
    container.appendChild(item);
  });
}

// ─── Chart ────────────────────────────────────────────────────────────
function updateChart(domain, agreements, conflicts) {
  const label = domain.replace(/^www\./, '').split('.')[0];
  const idx   = state.chartData.labels.indexOf(label);

  if (idx === -1) {
    state.chartData.labels.push(label);
    state.chartData.agreements.push(agreements);
    state.chartData.conflicts.push(conflicts);
  } else {
    state.chartData.agreements[idx] += agreements;
    state.chartData.conflicts[idx]  += conflicts;
  }

  if (state.chartInstance) {
    state.chartInstance.data.labels      = [...state.chartData.labels];
    state.chartInstance.data.datasets[0].data = [...state.chartData.agreements];
    state.chartInstance.data.datasets[1].data = [...state.chartData.conflicts];
    state.chartInstance.update('none');
    return;
  }

  const ctx = $('cite-chart');
  if (!ctx) return;

  state.chartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: [...state.chartData.labels],
      datasets: [
        {
          label: 'Agreements',
          data: [...state.chartData.agreements],
          backgroundColor: 'rgba(16, 185, 129, 0.65)',
          borderColor:     'rgba(16, 185, 129, 0.9)',
          borderWidth: 1,
          borderRadius: 5,
          borderSkipped: false,
        },
        {
          label: 'Conflicts',
          data: [...state.chartData.conflicts],
          backgroundColor: 'rgba(245, 158, 11, 0.65)',
          borderColor:     'rgba(245, 158, 11, 0.9)',
          borderWidth: 1,
          borderRadius: 5,
          borderSkipped: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          labels: {
            color: '#94A3B8',
            font: { family: 'Inter', size: 11, weight: '500' },
            boxWidth: 12,
            boxHeight: 12,
            borderRadius: 3,
          },
        },
        tooltip: {
          backgroundColor: '#121722',
          borderColor: 'rgba(255,255,255,0.08)',
          borderWidth: 1,
          titleColor: '#F0F4FF',
          bodyColor: '#94A3B8',
          titleFont: { family: 'Inter', size: 12, weight: '700' },
          bodyFont:  { family: 'Inter', size: 12 },
          padding: 12,
          cornerRadius: 8,
        },
      },
      scales: {
        x: {
          ticks: { color: '#4B5A73', font: { size: 11, family: 'Inter' }, maxRotation: 30 },
          grid:  { color: 'rgba(255,255,255,0.04)', drawBorder: false },
        },
        y: {
          ticks: { color: '#4B5A73', font: { size: 11, family: 'Inter' }, stepSize: 1 },
          grid:  { color: 'rgba(255,255,255,0.04)', drawBorder: false },
          beginAtZero: true,
        },
      },
    },
  });
}

// ─── History ───────────────────────────────────────────────────────────
$('btn-history').addEventListener('click', openHistory);

async function openHistory() {
  DOM.historySidebar().classList.add('open');
  DOM.historySidebar().setAttribute('aria-hidden', 'false');
  DOM.overlay().classList.add('visible');

  const list = DOM.historyList();
  list.innerHTML = `<div class="empty-state"><div class="spinner"></div><span>Loading history…</span></div>`;

  try {
    const resp  = await fetch(`${API}/api/history`);
    const data  = await resp.json();
    list.innerHTML = '';

    if (!data.history?.length) {
      list.innerHTML = `<div class="empty-state"><div class="empty-icon">📭</div><span>No research history yet.<br/>Run your first query to begin.</span></div>`;
      return;
    }

    data.history.forEach(h => {
      const item = document.createElement('div');
      item.className = 'history-item';
      item.setAttribute('role', 'listitem');
      item.setAttribute('tabindex', '0');
      item.setAttribute('aria-label', h.query);

      const date = new Date(h.created_at).toLocaleString('en', {
        month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });
      const conf = h.overall_confidence ? `${Math.round(h.overall_confidence)}%` : '—';
      const confColor = h.overall_confidence >= 70 ? 'var(--green)' : h.overall_confidence >= 45 ? 'var(--amber)' : 'var(--red)';

      item.innerHTML = `
        <div class="h-query">${escHtml(h.query)}</div>
        <div class="h-meta">
          <span class="badge badge-pending">${h.mode}</span>
          <span>${h.query_type}</span>
          <span>${date}</span>
          <span class="h-conf" style="color:${confColor}">${conf}</span>
        </div>
      `;
      item.onclick  = () => loadReport(h.session_id);
      item.onkeydown = e => { if (e.key === 'Enter') loadReport(h.session_id); };
      list.appendChild(item);
    });
  } catch (err) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">❌</div><span>Failed to load history.<br/>${escHtml(err.message)}</span></div>`;
  }
}

function closeHistory() {
  DOM.historySidebar().classList.remove('open');
  DOM.historySidebar().setAttribute('aria-hidden', 'true');
  DOM.overlay().classList.remove('visible');
}

async function loadReport(sessionId) {
  closeHistory();
  try {
    const resp = await fetch(`${API}/api/report/${sessionId}`);
    const data = await resp.json();
    if (data?.report) {
      resetUI(data.query || '', 'single');
      handleReport(data.report);
      data.report.verified_claims?.forEach(c => handleClaim(c));
      setIdle();
    }
  } catch (e) {
    showToast('Failed to load report', 'error');
  }
}

// ─── Export ────────────────────────────────────────────────────────────
function exportJSON() {
  if (!state.currentReport) { showToast('No report to export yet.', 'info'); return; }
  const blob = new Blob([JSON.stringify(state.currentReport, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `webintel_${state.sessionId?.substring(0, 8) || 'report'}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('JSON report downloaded!', 'success');
}

// ─── Share / copy link ─────────────────────────────────────────────────
async function shareReport() {
  const url = `${window.location.origin}?session=${state.sessionId || ''}`;
  try {
    await navigator.clipboard.writeText(url);
    showToast('Report link copied to clipboard!', 'success');
  } catch {
    showToast('Could not copy link.', 'info');
  }
}

// ─── Monitor ───────────────────────────────────────────────────────────
async function scheduleMonitor() {
  const query = DOM.queryInput().value.trim();
  if (!query) { showToast('Please enter a query to monitor.', 'error'); return; }
  try {
    const resp = await fetch(`${API}/api/monitor`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        mode: DOM.modeSelect().value,
        interval_hours: 24,
      }),
    });
    const d = await resp.json();
    showToast(d.message || 'Monitor scheduled!', 'success');
  } catch (e) {
    showToast('Failed to schedule monitor.', 'error');
  }
}

// ─── Progress Bar ──────────────────────────────────────────────────────
function advanceProgress(pct) {
  state.progress = pct;
  const bar = DOM.progressBar();
  if (bar) bar.style.width = `${pct}%`;
  if (pct >= 100) {
    setTimeout(() => { if (bar) { bar.style.width = '0%'; } }, 600);
  }
}

// ─── UI Reset ─────────────────────────────────────────────────────────
function resetUI(query, type = 'single') {
  state.running       = true;
  state.claimsCount   = 0;
  state.sourcesCount  = 0;
  state.conflictsCount = 0;
  state.resolvedCount = 0;
  state.currentReport = null;
  state.seenDomains   = new Set();
  state.chartData     = { labels: [], agreements: [], conflicts: [] };
  state.progress      = 0;
  if (state.chartInstance) { state.chartInstance.destroy(); state.chartInstance = null; }

  // Button
  const btn = DOM.btnRun();
  btn.disabled = true;
  DOM.btnRunIcon().textContent = '';
  DOM.btnRunLabel().innerHTML = '<span class="spinner"></span> Running…';

  // Status
  setStatus('live', 'Running');

  // Clear panels
  DOM.traceList().innerHTML    = '';
  DOM.claimsList().innerHTML   = `<div class="empty-state"><div class="empty-icon">🔍</div><span>Claims will stream here in real time</span></div>`;
  DOM.sourcesList().innerHTML  = `<div class="empty-state"><div class="empty-icon">🌍</div><span>Sources loading…</span></div>`;
  DOM.conflictList().innerHTML = `<div class="empty-state"><div class="empty-icon">✅</div><span>No conflicts detected yet</span></div>`;

  // Counters
  ['trace-count','claims-count','sources-count','conflict-count'].forEach(id => setCount(id, 0));
  ['stat-sources','stat-claims','stat-conflicts','stat-resolved'].forEach(id => $(id).textContent = '0');
  DOM.statConfidence().textContent = '—';
  DOM.centerTitle().textContent =
    type === 'compare' ? 'Comparison Table'
    : type === 'track'  ? 'Changes Detected'
    : 'Verified Claims';

  // Show/hide panels
  DOM.statsBar().classList.add('visible');
  DOM.mainPanel().classList.add('visible');
  DOM.bottomRow().classList.remove('visible');
  DOM.reportSummary().classList.remove('visible');

  DOM.mainPanel().scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function setIdle() {
  state.running = false;
  const btn = DOM.btnRun();
  btn.disabled = false;
  DOM.btnRunIcon().textContent = '⚡';
  DOM.btnRunLabel().textContent = 'Analyze';
  setStatus('idle', 'Ready');
  if (state.eventSource) {
    state.eventSource.close();
    state.eventSource = null;
  }
}

function setStatus(dot, text) {
  const d = DOM.statusDot();
  const t = DOM.statusText();
  const p = DOM.statusPill();
  d.className = `status-dot ${dot}`;
  t.textContent = text;
  if (dot === 'live') {
    p.classList.add('running');
  } else {
    p.classList.remove('running');
  }
}

// ─── Toast ────────────────────────────────────────────────────────────
function showToast(msg, type = 'info') {
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  const container = DOM.toastContainer();
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span class="toast-icon" aria-hidden="true">${icons[type] || 'ℹ️'}</span>
    <span class="toast-text">${escHtml(msg)}</span>
    <span class="toast-dismiss" onclick="this.parentElement.remove()" title="Dismiss" aria-label="Dismiss">✕</span>
  `;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 5000);
}

// ─── Helpers ──────────────────────────────────────────────────────────
function clearEmpty(el) {
  el.querySelectorAll('.empty-state').forEach(e => e.remove());
}

function setCount(id, n) {
  const el = $(id);
  if (!el) return;
  el.textContent = n;
  el.classList.toggle('has-items', n > 0);
}

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function extractDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return url; }
}

function getTrustInfo(domain) {
  const high   = ['gov.in','nic.in','rbi.org.in','sebi.gov.in','nseindia.com','bseindia.com','bloomberg.com','reuters.com','apnews.com','who.int','un.org','worldbank.org','nature.com','arxiv.org'];
  const medium = ['economictimes.indiatimes.com','livemint.com','thehindu.com','ndtv.com','hindustantimes.com','business-standard.com','bbc.com','bbc.co.uk','theguardian.com','nytimes.com','washingtonpost.com','techcrunch.com','wired.com','theverge.com','forbes.com','fortune.com','wikipedia.org','britannica.com'];
  const low    = ['reddit.com','quora.com','medium.com','substack.com','twitter.com','x.com','facebook.com','linkedin.com'];
  if (high.some(d   => domain === d || domain.endsWith('.' + d))) return { tier: 'high',    score: 90 };
  if (medium.some(d => domain === d || domain.endsWith('.' + d))) return { tier: 'medium',  score: 62 };
  if (low.some(d    => domain === d || domain.endsWith('.' + d))) return { tier: 'low',     score: 30 };
  return { tier: 'unknown', score: 45 };
}

function formatResolution(method) {
  return {
    official_source_priority: 'official source priority',
    majority_agreement:       'majority agreement',
    trust_score_majority:     'trust score',
    recency:                  'most recent timestamp',
    unresolved:               'unresolved',
  }[method] || method;
}

// ─── Keyboard shortcuts ────────────────────────────────────────────────
$('query-input').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    startQuery();
  }
});

document.addEventListener('keydown', e => {
  // Escape → close history sidebar
  if (e.key === 'Escape') closeHistory();
  // Ctrl/Cmd + K → focus query input
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    DOM.queryInput().focus();
    DOM.queryInput().select();
  }
});

// ─── Page load ────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  // Check api health silently
  fetch(`${API}/api/health`)
    .then(r => r.json())
    .then(d => {
      if (!d.groq)   console.warn('[WebIntel] Groq API key not configured');
      if (!d.tavily) console.warn('[WebIntel] Tavily API key not configured');
    })
    .catch(() => console.warn('[WebIntel] Backend not reachable at', API || window.location.origin));

  // Handle ?session= query param (load report from URL)
  const urlParams = new URLSearchParams(window.location.search);
  const session   = urlParams.get('session');
  if (session) {
    setTimeout(() => loadReport(session), 500);
  }
});
