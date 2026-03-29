// charts.js - Renders Chart.js citation graph for sources panel

const WebIntelCharts = {
    chartInstance: null,

    clear() {
        if (this.chartInstance) {
            this.chartInstance.destroy();
            this.chartInstance = null;
        }
    },

    render(sources) {
        const ctx = document.getElementById('citationChart').getContext('2d');
        
        // Destroy existing instance if it exists to redraw
        if (this.chartInstance) {
            this.chartInstance.destroy();
        }

        // Sort sources by trust and participation
        const validSources = sources.filter(s => !s.discarded).sort((a,b) => b.agreements_count - a.agreements_count);
        
        const labels = validSources.map(s => s.domain);
        const agreementData = validSources.map(s => s.agreements_count);
        const conflictData = validSources.map(s => s.conflicts_count);

        this.chartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Agreements',
                        data: agreementData,
                        backgroundColor: 'rgba(16, 185, 129, 0.7)', // green
                        borderColor: '#10b981',
                        borderWidth: 1
                    },
                    {
                        label: 'Conflicts',
                        data: conflictData,
                        backgroundColor: 'rgba(239, 68, 68, 0.7)', // red
                        borderColor: '#ef4444',
                        borderWidth: 1
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { 
                        stacked: true,
                        ticks: { color: '#94a3b8' },
                        grid: { color: 'rgba(255,255,255,0.05)' }
                    },
                    y: { 
                        stacked: true,
                        beginAtZero: true,
                        ticks: { color: '#94a3b8', stepSize: 1 },
                        grid: { color: 'rgba(255,255,255,0.05)' }
                    }
                },
                plugins: {
                    legend: {
                        labels: { color: '#e2e8f0' }
                    }
                }
            }
        });
    }
};

window.WebIntelCharts = WebIntelCharts;
