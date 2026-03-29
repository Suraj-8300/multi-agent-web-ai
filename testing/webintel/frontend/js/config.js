// ─── WebIntel API Configuration ───────────────────────────────────────────────
// Change API_BASE to your deployed backend URL when hosting frontend separately.
// Examples:
//   Local dev:     'http://localhost:8000'
//   Render:        'https://webintel-api.onrender.com'
//   Railway:       'https://webintel.up.railway.app'
//
// When serving frontend through FastAPI (same origin), use empty string ''.
// ──────────────────────────────────────────────────────────────────────────────

const CONFIG = {
  API_BASE: '',       // ← Change this to your backend URL for separate hosting
  APP_VERSION: '2.0.0',
  APP_NAME: 'WebIntel',
};

// Auto-detect: if running on file:// protocol, default to localhost backend
if (window.location.protocol === 'file:') {
  CONFIG.API_BASE = 'http://localhost:8000';
}

Object.freeze(CONFIG);
