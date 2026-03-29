// ui.js - Handles all DOM updates and animations

const UI = {
    elements: {
        liveDashboard: document.getElementById('live-dashboard'),
        analysisDashboard: document.getElementById('analysis-dashboard'),
        traceLog: document.getElementById('trace-log'),
        claimsContainer: document.getElementById('claims-container'),
        sourcesList: document.getElementById('sources-list'),
        conflictList: document.getElementById('conflict-list'),
        claimsCount: document.getElementById('claims-count'),
        sourcesCount: document.getElementById('sources-count'),
        confidenceBanner: document.getElementById('overall-confidence-banner'),
        confidenceScoreCircle: document.getElementById('confidence-path'),
        confidenceText: document.getElementById('confidence-text'),
        confidenceSummary: document.getElementById('confidence-summary-text'),
        tracePulse: document.getElementById('trace-pulse'),
        runBtn: document.getElementById('btn-run'),
        runSpinner: document.getElementById('run-spinner')
    },

    clearDashboards() {
        this.elements.traceLog.innerHTML = '';
        this.elements.claimsContainer.innerHTML = '';
        this.elements.sourcesList.innerHTML = '';
        this.elements.conflictList.innerHTML = '';
        this.elements.claimsCount.textContent = '0';
        this.elements.sourcesCount.textContent = '0';
        this.elements.confidenceBanner.classList.add('hidden');
        this.elements.liveDashboard.classList.add('hidden');
        this.elements.analysisDashboard.classList.add('hidden');
        this.elements.tracePulse.classList.add('active');
        
        if (window.WebIntelCharts) window.WebIntelCharts.clear();
    },

    startLoading() {
        const btnText = this.elements.runBtn.querySelector('span');
        btnText.textContent = "Verifying...";
        this.elements.runBtn.disabled = true;
        this.elements.runSpinner.classList.remove('hidden');
        this.elements.liveDashboard.classList.remove('hidden');
        
        // Scroll to dashboard smoothly
        this.elements.liveDashboard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },

    stopLoading() {
        const btnText = this.elements.runBtn.querySelector('span');
        btnText.textContent = "Run Verification";
        this.elements.runBtn.disabled = false;
        this.elements.runSpinner.classList.add('hidden');
        this.elements.tracePulse.classList.remove('active');
        this.elements.tracePulse.style.background = 'var(--accent-green)';
    },

    appendTrace(msg, isDone = false) {
        const step = document.createElement('div');
        step.className = `trace-step fade-in ${isDone ? 'done' : 'active'}`;
        step.innerHTML = `<span class="step-icon">⚡</span><span>${msg}</span>`;
        this.elements.traceLog.appendChild(step);
        // Scroll to bottom
        this.elements.traceLog.scrollTop = this.elements.traceLog.scrollHeight;
    },

    updateTraceActiveToDone() {
        // Mark all current active traces as done before appending new ones
        const activeSteps = this.elements.traceLog.querySelectorAll('.trace-step.active');
        activeSteps.forEach(step => {
            step.classList.remove('active');
            step.classList.add('done');
            step.querySelector('.step-icon').textContent = '✓';
        });
    },

    renderClaim(claim) {
        // Evaluate confidence css class
        let scoreClass = 'score-mid';
        let fillClass = 'fill-mid';
        if (claim.confidence >= 80) { scoreClass = 'score-high'; fillClass = 'fill-high'; }
        else if (claim.confidence <= 60) { scoreClass = 'score-low'; fillClass = 'fill-low'; }

        // Source links pill HTML
        const sourceHtml = claim.supporting_sources.map(src => `<div class="source-pill"><a href="${src}" target="_blank" title="${src}">🔗 ${new URL(src).hostname}</a></div>`).join('');
        
        const conflictWarning = claim.conflicting_sources && claim.conflicting_sources.length > 0
            ? `<div class="conflict-warning" title="${claim.conflict_detail}">⚠️ Conflict Detected</div>`
            : '';

        const card = document.createElement('div');
        card.className = 'claim-card fade-in';
        card.innerHTML = `
            <div class="claim-header">
                <h4 class="claim-text">${claim.claim}</h4>
                <div class="claim-confidence">
                    <span class="score-badge ${scoreClass}">${claim.confidence}%</span>
                    <div class="confidence-bar-bg">
                        <div class="confidence-bar-fill ${fillClass}" style="width: ${claim.confidence}%"></div>
                    </div>
                </div>
            </div>
            <div class="claim-meta">
                ${sourceHtml}
                ${conflictWarning}
            </div>
        `;
        this.elements.claimsContainer.appendChild(card);
        this.elements.claimsCount.textContent = this.elements.claimsContainer.children.length;
    },

    renderSource(source) {
        // check if exists to prevent duplicates visually
        if(document.querySelector(`[data-domain="${source.domain}"]`)) return;

        let badgeClass = 'trust-mid';
        if (source.trust_tier === 'high') badgeClass = 'trust-high';
        else if (source.trust_tier === 'low') badgeClass = 'trust-low';

        const sourceEl = document.createElement('div');
        sourceEl.className = 'source-item fade-in';
        sourceEl.dataset.domain = source.domain;
        sourceEl.innerHTML = `
            <div class="source-header">
                <span class="domain-name">${source.domain} ${source.discarded ? '<span style="color:var(--accent-danger);">(Discarded)</span>' : ''}</span>
                <span class="trust-badge ${badgeClass}">${source.trust_tier}</span>
            </div>
            <div class="source-stats">
                <span>✅ ${source.agreements_count} Agreements</span>
                <span style="${source.conflicts_count > 0 ? 'color: var(--accent-warning);' : ''}">⚠️ ${source.conflicts_count} Conflicts</span>
            </div>
        `;
        this.elements.sourcesList.appendChild(sourceEl);
        this.elements.sourcesCount.textContent = this.elements.sourcesList.children.length;
    },

    renderConflict(conflict) {
        const cEl = document.createElement('div');
        cEl.className = 'conflict-item fade-in';
        cEl.innerHTML = `
            <h4>Conflict: ${conflict.claim}</h4>
            <p><strong>Reason:</strong> ${conflict.conflict_detail}</p>
            <p style="margin-top: 6px;"><strong>Resolution:</strong> ${conflict.resolution_method} -> ${conflict.status}</p>
        `;
        this.elements.conflictList.appendChild(cEl);
    },

    renderFinalReport(report) {
        this.elements.analysisDashboard.classList.remove('hidden');
        this.elements.confidenceBanner.classList.remove('hidden');
        
        // Render final score
        this.elements.confidenceText.textContent = `${report.overall_confidence}%`;
        this.elements.confidenceScoreCircle.style.strokeDasharray = `${report.overall_confidence}, 100`;

        // Update score color dynamically
        if (report.overall_confidence >= 80) this.elements.confidenceScoreCircle.style.stroke = 'var(--accent-green)';
        else if (report.overall_confidence >= 60) this.elements.confidenceScoreCircle.style.stroke = 'var(--accent-warning)';
        else this.elements.confidenceScoreCircle.style.stroke = 'var(--accent-danger)';

        // Render Conflicts
        if (report.verified_claims) {
            const conflicts = report.verified_claims.filter(c => c.status === 'conflict' || c.status === 'unresolved' || c.conflicting_sources?.length > 0);
            if (conflicts.length === 0) {
                this.elements.conflictList.innerHTML = '<p style="color:var(--accent-green)">No significant conflicts detected across sources.</p>';
            } else {
                conflicts.forEach(c => this.renderConflict(c));
            }
        }

        // Render Graph
        if (window.WebIntelCharts) {
            window.WebIntelCharts.render(report.sources);
        }

        // Enable Export Buttons
        document.getElementById('btn-export-json').disabled = false;
        document.getElementById('btn-export-pdf').disabled = false;
        
        let summary = `Verification complete. Processed ${report.total_sources_visited} sources, resolved ${report.conflicts_resolved} conflicts.`;
        this.elements.confidenceSummary.textContent = summary;
    }
};

window.UI = UI;
