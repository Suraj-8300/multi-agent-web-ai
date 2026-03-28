// app.js - Main Application Controller

document.addEventListener('DOMContentLoaded', () => {
    const backend = new MockBackend(window.UI);
    let currentReport = null;

    // Controls
    const btnRun = document.getElementById('btn-run');
    const inputQuery = document.getElementById('query-input');
    const selMode = document.getElementById('query-mode');
    const selType = document.getElementById('query-type');
    const btnHistory = document.getElementById('btn-history');
    const btnCloseHistory = document.getElementById('btn-close-history');
    const sidebar = document.getElementById('history-sidebar');
    const overlay = document.getElementById('overlay');

    // Execution Logic
    const triggerSearch = () => {
        const query = inputQuery.value.trim();
        if (!query) {
            alert("Please enter a query.");
            return;
        }

        const mode = selMode.value;
        const type = selType.value;
        
        // Execute the mock backend stream
        backend.runPipeline(query, mode, type);
    };

    btnRun.addEventListener('click', triggerSearch);
    inputQuery.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') triggerSearch();
    });

    // History interaction
    const toggleHistory = () => {
        const isOpen = sidebar.classList.contains('open');
        if (isOpen) {
            sidebar.classList.remove('open');
            overlay.classList.remove('visible');
        } else {
            sidebar.classList.add('open');
            overlay.classList.add('visible');
        }
    };

    btnHistory.addEventListener('click', toggleHistory);
    btnCloseHistory.addEventListener('click', toggleHistory);
    overlay.addEventListener('click', toggleHistory);

    // Initial message
    inputQuery.focus();
});
