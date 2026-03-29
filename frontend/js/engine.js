// engine.js — Gemini-powered WebIntel demo engine
// Calls Gemini API, progressively renders trace/claims/sources/conflicts/chart

const API_KEY = CONFIG.GEMINI_API_KEY;
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.GEMINI_MODEL}:generateContent?key=${API_KEY}`;

let chartInstance = null;
let lastReport = null;

// ─── HELPERS ───
const sleep = ms => new Promise(r => setTimeout(r, ms));
const $ = id => document.getElementById(id);

function confLevel(c) { return c >= 75 ? 'high' : c >= 50 ? 'mid' : 'low'; }
function statusClass(s) { return s === 'verified' ? 'verified' : s === 'conflict' ? 'conflict' : 'unverified'; }

// ─── TRACE RENDERING ───
const AGENTS = [
  { icon: '🧠', name: 'Planner Agent', log: '' },
  { icon: '🌐', name: 'Search Agent', log: '' },
  { icon: '📊', name: 'Extraction Agent', log: '' },
  { icon: '🔍', name: 'Verification Agent', log: '' },
  { icon: '📈', name: 'Report Agent', log: '' },
];

function initTraces() {
  const list = $('traceList');
  list.innerHTML = '';
  AGENTS.forEach((a, i) => {
    list.innerHTML += `
      <div class="trace-item waiting" id="trace-${i}">
        <div class="trace-icon">${a.icon}</div>
        <div class="trace-info">
          <div class="trace-name">${a.name}</div>
          <div class="trace-status waiting" id="traceStatusText-${i}">— WAITING</div>
          <div class="trace-log" id="traceLog-${i}"></div>
        </div>
      </div>`;
  });
}

async function activateTrace(i, logMsg) {
  const el = $(`trace-${i}`);
  const st = $(`traceStatusText-${i}`);
  const lg = $(`traceLog-${i}`);
  el.className = 'trace-item running';
  st.className = 'trace-status running';
  st.innerHTML = '<span class="pulse-dot"></span>RUNNING';
  lg.innerHTML = logMsg;
  $('tracePanel').classList.add('active-glow');
}

function completeTrace(i, logMsg) {
  const el = $(`trace-${i}`);
  const st = $(`traceStatusText-${i}`);
  const lg = $(`traceLog-${i}`);
  el.className = 'trace-item done';
  st.className = 'trace-status done';
  st.textContent = '✓ COMPLETE';
  if (logMsg) lg.innerHTML = logMsg;
}

// ─── CLAIM CARD ───
function renderClaim(claim) {
  const cl = confLevel(claim.confidence);
  const sc = statusClass(claim.status);
  const srcText = (claim.supporting_sources || []).map(u => { try { return new URL(u).hostname; } catch(e) { return u; }}).join(', ');
  return `
    <div class="claim-card ${sc}">
      <div class="claim-text">${claim.claim}</div>
      <div class="claim-meta">
        <div class="conf-wrap">
          <div class="conf-track"><div class="conf-fill ${cl}" data-w="${claim.confidence}%" style="width:0"></div></div>
          <span class="conf-pct ${cl}">${claim.confidence}%</span>
        </div>
        <span class="claim-flag ${sc}">${claim.status}</span>
      </div>
      <div class="claim-sources">${srcText}</div>
    </div>`;
}

// ─── SOURCE ITEM ───
function renderSource(src) {
  const tier = src.trust_tier === 'high' ? 'high' : src.trust_tier === 'medium' ? 'mid' : src.discarded ? 'disc' : 'low';
  const label = src.discarded ? 'DISCARDED' : src.trust_tier.toUpperCase();
  return `
    <div class="source-item ${src.discarded ? 'discarded' : ''}">
      <div class="src-top">
        <span class="src-domain">${src.domain}</span>
        <span class="trust-badge ${tier}">${label}</span>
      </div>
      <div class="src-trust-row">
        <div class="src-trust-track"><div class="src-trust-fill ${tier}" data-w="${src.trust_score}%" style="width:0"></div></div>
        <span class="src-trust-val ${tier}">${src.trust_score}</span>
      </div>
      <div class="src-stats">
        <span class="src-stat"><span class="dot agree"></span>${src.agreements_count} agree</span>
        <span class="src-stat"><span class="dot conflict"></span>${src.conflicts_count} conflict</span>
      </div>
    </div>`;
}

// ─── CONFLICT ITEM ───
function renderConflictItem(c) {
  return `
    <div class="conflict-item">
      <div class="conflict-claims">
        <div class="conf-claim-a">${c.claim}<div class="conf-src">${(c.supporting_sources||[])[0]||''}</div></div>
        <div class="conf-claim-b">${c.conflict_detail||'Conflicting data found'}<div class="conf-src">${(c.conflicting_sources||[])[0]||''}</div></div>
      </div>
      <div class="conflict-resolution">⚡ ${c.resolution_method || 'Unresolved'} → ${c.status}</div>
    </div>`;
}

// ─── COMPARE TABLE ───
function renderCompareTable(table) {
  if (!table || !table.length) { $('compareContainer').innerHTML = '<p style="color:var(--text2);">No compare data.</p>'; return; }
  const keys = Object.keys(table[0]);
  const criterion = keys[0];
  const entities = keys.slice(1);
  let html = '<div style="overflow-x:auto"><table class="compare-table"><thead><tr>';
  html += `<th>${criterion}</th>`;
  entities.forEach(e => html += `<th>${e}</th>`);
  html += '</tr></thead><tbody>';
  table.forEach(row => {
    html += '<tr>';
    keys.forEach((k, i) => html += `<td${i > 0 ? ' style="color:#fff"' : ''}>${row[k]}</td>`);
    html += '</tr>';
  });
  html += '</tbody></table></div>';
  $('compareContainer').innerHTML = html;
}

// ─── CHART ───
function renderChart(sources) {
  if (chartInstance) chartInstance.destroy();
  const valid = (sources || []).filter(s => !s.discarded);
  const ctx = $('citationChart').getContext('2d');
  chartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: valid.map(s => s.domain),
      datasets: [
        { label: 'Agreements', data: valid.map(s => s.agreements_count), backgroundColor: 'rgba(0,229,160,0.7)', borderColor: 'rgba(0,229,160,1)', borderWidth: 1, borderRadius: 3 },
        { label: 'Conflicts', data: valid.map(s => s.conflicts_count), backgroundColor: 'rgba(255,74,107,0.7)', borderColor: 'rgba(255,74,107,1)', borderWidth: 1, borderRadius: 3 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#5a7a96', font: { family: "'Syne Mono', monospace", size: 10 }, boxWidth: 12 } } },
      scales: {
        x: { ticks: { color: '#5a7a96', font: { family: "'Syne Mono', monospace", size: 9 } }, grid: { color: '#1c2a3a' } },
        y: { ticks: { color: '#5a7a96', font: { family: "'Syne Mono', monospace", size: 10 } }, grid: { color: '#1c2a3a' }, beginAtZero: true }
      }
    }
  });
}

// ─── REPORT SECTION ───
function renderReport(report) {
  $('reportSection').style.display = '';
  $('reportQuery').textContent = `Query: ${report.query}`;
  const conf = report.overall_confidence || 0;
  const confColor = conf >= 75 ? 'var(--green)' : conf >= 50 ? 'var(--amber)' : 'var(--red)';
  $('scoreRow').innerHTML = `
    <div class="gauge-wrap">
      <svg class="gauge-svg" width="90" height="90" viewBox="0 0 90 90">
        <circle cx="45" cy="45" r="36" fill="none" stroke="var(--border)" stroke-width="6"/>
        <circle cx="45" cy="45" r="36" fill="none" stroke="${confColor}" stroke-width="6"
          stroke-dasharray="226.2" stroke-dashoffset="226.2" stroke-linecap="round" transform="rotate(-90 45 45)" id="gaugeArc"/>
        <text x="45" y="41" text-anchor="middle" font-family="'Syne',sans-serif" font-size="18" font-weight="800" fill="#fff">${conf}%</text>
        <text x="45" y="55" text-anchor="middle" font-family="'Syne Mono',monospace" font-size="7" fill="var(--text2)" letter-spacing="1">CONFIDENCE</text>
      </svg>
    </div>
    <div class="score-chip"><span class="score-num y">${report.conflicts_detected || 0}</span><span class="score-lbl">Conflicts</span></div>
    <div class="score-chip"><span class="score-num b">${report.total_sources_visited || 0}</span><span class="score-lbl">Sources</span></div>
    <div class="score-chip"><span class="score-num g">${report.conflicts_resolved || 0}</span><span class="score-lbl">Resolved</span></div>`;
  // Animate gauge
  setTimeout(() => {
    const arc = $('gaugeArc');
    if (arc) { arc.style.transition = 'stroke-dashoffset 1.4s cubic-bezier(0.4,0,0.2,1)'; arc.style.strokeDashoffset = 226.2 - (226.2 * conf / 100); }
  }, 200);
}

// ─── ANIMATE BARS ───
function animateBars() {
  document.querySelectorAll('[data-w]').forEach(el => {
    const w = el.getAttribute('data-w');
    el.style.width = '0';
    setTimeout(() => { el.style.width = w; }, 80);
  });
}

// ─── HISTORY ───
function saveHistory(query, mode, type, confidence) {
  let hist = JSON.parse(localStorage.getItem('webintel_history') || '[]');
  hist.unshift({ query, mode, type, confidence, ts: new Date().toISOString() });
  if (hist.length > 20) hist = hist.slice(0, 20);
  localStorage.setItem('webintel_history', JSON.stringify(hist));
  loadHistory();
}

function loadHistory() {
  const hist = JSON.parse(localStorage.getItem('webintel_history') || '[]');
  const list = $('historyList');
  if (!hist.length) { list.innerHTML = '<p style="color:var(--text2);text-align:center;padding:40px 0;">No past queries.</p>'; return; }
  list.innerHTML = hist.map(h => `
    <div class="history-item" onclick="document.getElementById('queryInput').value='${h.query.replace(/'/g,"\\'")}';toggleSidebar();">
      <div class="hi-query">${h.query}</div>
      <div class="hi-meta">
        <span>${h.mode} · ${h.type}</span>
        <span class="hi-conf ${h.confidence >= 70 ? 'high' : 'mid'}">${h.confidence}%</span>
      </div>
    </div>`).join('');
}

// ─── GEMINI CALL ───
async function callGemini(query, mode, type) {
  const agentCounts = { quick: 3, fact_check: 4, research: 8, deep_dive: 15 };
  const numAgents = agentCounts[mode] || 8;

  const prompt = `You are the WebIntel verification backend. Return ONLY raw valid JSON (no markdown fences, no explanation).
The user query: "${query}" | Mode: ${mode} | Type: ${type}
Generate a realistic intelligence report. Schema:
{
  "query":"${query}","query_type":"${type}","mode":"${mode}",
  "verified_claims":[{"claim":"string","confidence":number(0-100),"supporting_sources":["url"],"conflicting_sources":["url"],"conflict_detail":"string or null","resolution_method":"string or null","status":"verified"|"conflict"|"unresolved"}],
  "sources":[{"url":"string","domain":"string","trust_tier":"high"|"medium"|"low","trust_score":number(0-100),"agreements_count":number,"conflicts_count":number,"discarded":boolean}],
  "overall_confidence":number(0-100),
  ${type === 'compare' ? '"compare_table":[{"criterion":"string",...entity_columns}],' : ''}
  "executive_summary":"string (2-3 sentence analysis)",
  "total_sources_visited":number,"conflicts_detected":number,"conflicts_resolved":number
}
Rules: Use ${numAgents} simulated sub-queries. Include realistic URLs (e.g. .gov.in, reuters.com for high trust). Include 1-3 conflicts with resolution. Return ONLY valid JSON.`;

  const resp = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
  });
  if (!resp.ok) throw new Error(`API Error: ${resp.status}`);
  const data = await resp.json();
  let text = data.candidates[0].content.parts[0].text.trim();
  // Strip markdown fences
  text = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
  return JSON.parse(text);
}

// ─── MAIN PIPELINE ───
async function runPipeline() {
  const query = $('queryInput').value.trim();
  if (!query) return;
  const mode = $('modeSelect').value;
  const type = $('typeSelect').value;
  const btn = $('runBtn');

  // Reset UI
  $('emptyState').classList.remove('visible');
  $('mainContent').style.display = '';
  $('reportSection').style.display = 'none';
  $('claimsList').innerHTML = '';
  $('sourcesList').innerHTML = '';
  $('conflictList').innerHTML = '';
  $('compareContainer').innerHTML = '';
  $('claimCount').textContent = '0';
  $('sourcesCount').textContent = '0';
  $('conflictBadge').textContent = '0';
  btn.classList.add('loading');
  btn.textContent = '⟳ Analyzing…';
  $('traceStatus').textContent = 'RUNNING';

  initTraces();

  try {
    // Step 1 — Planner
    await activateTrace(0, 'Decomposing query into sub-tasks...');
    await sleep(1200);
    const agentN = { quick: 3, fact_check: 4, research: 8, deep_dive: 15 }[mode] || 8;
    completeTrace(0, `${agentN} sub-queries generated`);

    // Step 2 — Search
    await activateTrace(1, `Dispatching ${agentN} parallel searches...`);
    await sleep(800);

    // Fire Gemini API in parallel with the animation
    const apiPromise = callGemini(query, mode, type);
    await sleep(1500);
    completeTrace(1, 'Raw content collected from sources');

    // Step 3 — Extraction
    await activateTrace(2, 'Parsing factual claims from content...');
    const report = await apiPromise; // wait for real data
    lastReport = report;
    completeTrace(2, `${report.verified_claims.length} claims extracted`);

    // Step 4 — Verification (stream claims one by one)
    await activateTrace(3, 'Cross-referencing claims across sources...');
    const claims = report.verified_claims || [];
    for (let i = 0; i < claims.length; i++) {
      $('claimsList').innerHTML += renderClaim(claims[i]);
      $('claimCount').textContent = `${i + 1} / ${claims.length}`;
      $(`traceLog-3`).innerHTML = `Verifying claim ${i + 1}/${claims.length}`;
      animateBars();
      await sleep(450);
    }
    completeTrace(3, `${claims.length} claims verified · ${report.conflicts_detected || 0} conflicts found`);

    // Stream sources
    const sources = report.sources || [];
    for (let i = 0; i < sources.length; i++) {
      $('sourcesList').innerHTML += renderSource(sources[i]);
      $('sourcesCount').textContent = `${i + 1} visited`;
      await sleep(200);
    }
    animateBars();

    // Step 5 — Report
    await activateTrace(4, 'Assembling intelligence report...');
    await sleep(800);

    // Render conflicts
    const conflicts = claims.filter(c => c.status === 'conflict' || c.status === 'unresolved');
    $('conflictBadge').textContent = `${conflicts.length} conflicts`;
    if (conflicts.length === 0) {
      $('conflictList').innerHTML = '<p style="color:var(--green);font-family:var(--mono);font-size:11px;">No conflicts detected.</p>';
    } else {
      $('conflictList').innerHTML = conflicts.map(renderConflictItem).join('');
    }

    // Compare table
    if (type === 'compare' && report.compare_table) renderCompareTable(report.compare_table);

    // Chart
    renderChart(sources);

    // Executive summary
    if (report.executive_summary) {
      $('execText').innerHTML = report.executive_summary;
    } else {
      $('execText').textContent = `Analysis complete. ${report.total_sources_visited} sources visited, ${report.conflicts_resolved} conflicts resolved from ${report.conflicts_detected} detected.`;
    }

    // Report score section
    renderReport(report);

    completeTrace(4, 'Report assembled · Streaming complete');
    $('traceStatus').textContent = 'DONE';
    $('footerMeta').textContent = `Generated: ${new Date().toISOString().slice(0, 10)} · WebIntel / Antigravity`;
    $('btnExportJson').disabled = false;

    saveHistory(query, mode, type, report.overall_confidence);

  } catch (err) {
    console.error(err);
    $('traceStatus').textContent = 'ERROR';
    const list = $('traceList');
    list.innerHTML += `<div class="trace-item" style="background:rgba(255,74,107,0.1)">
      <div class="trace-icon">⚠️</div>
      <div class="trace-info"><div class="trace-name" style="color:var(--red)">Pipeline Error</div>
      <div class="trace-log">${err.message}</div></div></div>`;
  }

  btn.classList.remove('loading');
  btn.textContent = '▶ Analyze';
}

// ─── EVENT BINDINGS ───
document.addEventListener('DOMContentLoaded', () => {
  loadHistory();

  $('runBtn').addEventListener('click', runPipeline);
  $('queryInput').addEventListener('keypress', e => { if (e.key === 'Enter') runPipeline(); });

  document.querySelectorAll('.ex-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      $('queryInput').value = chip.dataset.q || chip.textContent;
      if (chip.dataset.type) $('typeSelect').value = chip.dataset.type;
      $('emptyState').classList.remove('visible');
    });
  });

  $('btnExportJson').addEventListener('click', () => {
    if (!lastReport) return;
    const blob = new Blob([JSON.stringify(lastReport, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `webintel_report_${Date.now()}.json`;
    a.click();
  });
});

// ─── GLOBAL UI FUNCTIONS ───
function toggleSidebar() {
  $('sidebar').classList.toggle('open');
  $('overlay').classList.toggle('open');
}

function switchTab(id, btn) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  $('tab-' + id).classList.add('active');
  btn.classList.add('active');
}
