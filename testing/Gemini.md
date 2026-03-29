# GEMINI.md — WebIntel
### Autonomous Multi-Agent Web Intelligence System
**Team:** Antigravity | **Hackathon:** 36 Hours

---

## What This System Is

WebIntel is NOT a chatbot. It is NOT a search engine.

It is a real-time reasoning and verification system. The user asks a question, and instead of answering from memory, the system autonomously dispatches multiple AI agents to search the web in parallel, extracts structured facts from everything it finds, cross-verifies those facts across sources, detects conflicts, resolves them with logic, and returns a confidence-scored structured report — all streamed live to the UI as it happens.

One-line identity: **WebIntel searches, verifies, and explains — using parallel agents, in real time.**

---

## Tech Stack

- **Backend:** FastAPI (Python) with async/await throughout
- **LLM:** Groq API (`llama-3.3-70b-versatile`) — used for planning, extraction, verification, report generation
- **Search:** Tavily API — AI-optimized search that returns clean content + URLs, no raw scraping needed
- **Streaming:** Server-Sent Events (SSE) — streams live agent steps from backend to frontend
- **Database:** Supabase (Postgres) — stores reports, query history, scheduled monitor jobs
- **Frontend:** Vanilla HTML + CSS + JavaScript (no framework, no build step)
- **Frontend Charts:** Chart.js — for citation graph and confidence visualization
- **Deploy:** Backend on Railway or Render, Frontend served via FastAPI `/static` or Vercel

---

## Project File Structure

```
webintel/
├── backend/
│   ├── main.py                  ← FastAPI app, all routes, SSE endpoint, orchestration pipeline
│   ├── agents/
│   │   ├── __init__.py
│   │   ├── planner.py           ← Breaks query into sub-tasks using Groq LLM
│   │   ├── search_agent.py      ← Runs parallel searches via Tavily + URL fetcher
│   │   ├── extraction_agent.py  ← Pulls structured claims from raw content
│   │   ├── verification_agent.py← Compares claims, scores confidence, detects conflicts, builds compare table
│   │   └── report_agent.py      ← Assembles final structured output + diff for track mode
│   ├── services/
│   │   ├── __init__.py
│   │   ├── llm_service.py       ← Single wrapper for all Groq LLM calls (with retry + JSON enforcement)
│   │   ├── tavily_service.py    ← Tavily search wrapper
│   │   ├── supabase_service.py  ← DB read/write helpers (reports, history, monitors)
│   │   └── sse_service.py       ← In-memory session queue for SSE streaming
│   ├── utils/
│   │   ├── __init__.py
│   │   ├── trust_scorer.py      ← Assigns trust tier to domains (hardcoded list)
│   │   └── conflict_resolver.py ← Confidence scoring and conflict resolution logic
│   ├── models/
│   │   ├── __init__.py
│   │   └── models.py            ← All Pydantic models: QueryRequest, Claim, SourceInfo, FinalReport, etc.
│   └── __init__.py
└── frontend/
    ├── index.html               ← Single page app shell (all UI structure)
    ├── css/
    │   └── main.css             ← All styles, design tokens, animations, responsive layout
    ├── js/
    │   ├── config.js            ← API_BASE config (change for separate deployment)
    │   └── app.js               ← Full app controller: SSE, rendering, state, all UI logic
    ├── _redirects               ← Netlify SPA redirect rule
    └── vercel.json              ← Vercel rewrite rule for SPA
```

> **Note:** All JS logic lives in a single `app.js` file. There is no separate `stream.js`, `ui.js`, `charts.js`, or `export.js` — all SSE handling, DOM rendering, chart setup, history, and export are implemented inside `app.js`.

---

## How the System Works (Full Flow)

### Step 1 — Query Planning
User submits a query with a mode and query type. The Planner Agent calls Groq with the query and asks it to decompose it into N focused sub-queries, each assigned a source type (news, official, academic, financial). The number of sub-queries depends on the mode — 3 for Quick, up to 15 for Deep Dive.

### Step 2 — Parallel Search
All sub-queries are dispatched simultaneously using `asyncio.gather`. Each Search Agent calls Tavily with its specific sub-query and returns raw content + source URLs. Because they run in parallel, total time equals the slowest agent, not the sum of all agents. This is what makes the system feel fast.

### Step 3 — Claim Extraction
The Extraction Agent calls Groq on all collected raw content and asks it to pull out structured, atomic facts. Each claim comes with the source URL it was pulled from and a timestamp. Output is always a clean list of `{claim, source_url, timestamp}` objects.

### Step 4 — Verification
The Verification Agent groups similar claims from different sources, compares them, detects conflicts, and scores confidence. If confidence falls below the mode's threshold, it triggers a re-query — the planner generates new sub-queries for the weak areas, agents run again, and new claims are merged into the pool before re-verifying.

### Step 5 — Report Generation
The Report Agent in `report_agent.py` assembles everything into the final structured output. For Compare mode, `verification_agent.py` builds the comparison table via LLM. For Track mode, diff logic runs inside `report_agent.py` directly — it compares the current claims against the previous set and outputs added/removed/changed items.

### Step 6 — Streaming to UI
Every step above pushes events to an in-memory SSE queue tied to the session ID. The frontend connects to `/stream/{session_id}` via EventSource and receives live updates — trace steps, individual claim cards as they're verified, and finally the full report.

---

## Parallel Agent Architecture

This is the most important technical decision. Every search runs concurrently, not sequentially.

The Planner produces a list of sub-queries. The backend runs all of them at once using `asyncio.gather`. Each sub-query is a separate async task hitting Tavily with a different focused query and source type filter.

Agent roles:
- **News Agent** — targets recent articles, media coverage, blogs
- **Official Agent** — targets government sites, company IR pages, official exchanges
- **Academic Agent** — targets encyclopedias, research summaries, reference content
- **Financial Agent** — targets stock portals, financial databases, market data

For Compare mode, a separate batch of agents is spawned per entity being compared (e.g. one batch for Jio, one for Airtel, one for Vi) — all running in parallel simultaneously.

One agent failing must never stop the others. Always use `return_exceptions=True` in gather calls and continue with whatever results succeeded.

---

## Verification Logic

### Conflict Detection
- **Numeric claims:** more than 3% variance between sources = conflict
- **Factual claims:** directly contradictory statements = conflict
- **Same claim from same domain:** ignore duplicates, count once

### Conflict Resolution Priority
1. Official/government source wins
2. Majority agreement across sources wins
3. Most recent timestamp wins
4. If none resolve it → mark as `unresolved` and surface to user

### Confidence Scoring (0–100)
- 3+ high-trust sources agree → 90+
- Mixed trust levels → 60–80
- Active conflict present → below 60
- Single source only → cap at 55 regardless of trust

### Re-query Trigger
- Quick mode: never re-queries
- Fact Check: re-query if any claim below 60
- Research: re-query if overall confidence below 70
- Deep Dive: re-query if overall confidence below 80

---

## Source Trust System

Trust tiers are hardcoded in `utils/trust_scorer.py` — no ML needed here.

**High trust (score 85–95):** Government domains (.gov.in, .nic.in), official exchange sites (nseindia.com, bseindia.com), regulatory bodies (rbi.org.in, sebi.gov.in), globally recognized wire services (reuters.com, apnews.com, bloomberg.com), WHO, UN

**Medium trust (score 55–70):** Established national news (economictimes, livemint, thehindu, ndtv), major tech media (techcrunch, wired, theverge), Forbes, business publications

**Low trust (score 25–40):** Reddit, Quora, personal blogs, Medium posts, unknown domains

**Unknown:** Default to 45. Surface to user as "unverified source".

Discard sources below score 25 automatically. Still show them in the UI as "discarded" so the user can audit the decision.

---

## Output Data Structure

Every response from every Groq call must be valid JSON. No markdown, no explanation text, just the raw JSON object. This is critical — enforce it in every prompt. The `call_llm_json()` function in `llm_service.py` handles stripping markdown fences and retrying if the parse fails.

The final report contains:
- `query` — original user query
- `query_type` — single / compare / track / summarise_url
- `mode` — quick / fact_check / research / deep_dive
- `session_id` — UUID for this research session
- `verified_claims` — array of claims, each with: statement, confidence_score, supporting_sources, conflicting_sources, conflict_detail, resolution_method, status (verified / conflict / unresolved)
- `sources` — all sources visited, each with URL, domain, trust_tier, trust_score, agreement_count, conflict_count, discarded flag
- `overall_confidence` — single number (0–100) for the whole report
- `compare_table` — populated only for compare mode (criterion → cells per entity, each with confidence)
- `diff` — populated only for track mode (added / removed / changed claims vs previous run)
- `total_sources_visited`, `conflicts_detected`, `conflicts_resolved` — summary stats
- `generated_at` — ISO timestamp

---

## Modes

| Mode | Sub-queries | Sources | Re-query threshold | Speed |
|---|---|---|---|---|
| quick | 3 | 2–3 | Never | ~5 sec |
| fact_check | 4 | 3–5 | < 60% | ~10 sec |
| research | 8 | 5–8 | < 70% | ~20 sec |
| deep_dive | 15 | 10–20 | < 80% | ~45 sec |

---

## Query Types

**single** — Standard. User asks about one thing. Output is claim list + sources + conflict log.

**compare** — User wants A vs B vs C. Agent spawns separate search batches per entity. Output is a comparison table with rows per criterion and columns per entity. Each cell has a confidence indicator.

**track / monitor** — Same query on a schedule. Each run diffs against the previous saved report. Output highlights new claims, removed claims, confidence changes. Stored in Supabase and triggered via the `/api/monitor` endpoint (APScheduler integration is a planned extension).

**summarise_url** — User pastes a URL. `search_agent.fetch_url_content()` fetches the page via httpx, extracts all factual claims, then verifies each against external sources. Output shows which claims are verified, false, or undeterminable.

---

## SSE Streaming — Event Types

The backend pushes these event types through the SSE queue in real time:

- `trace` — one agent step completed. Has step number and message. Updates the live trace panel.
- `claim` — a single verified claim is ready. Pushed immediately as each claim clears verification, not batched at the end. This makes the UI feel alive.
- `report` — the complete final report object. Pushed once at the very end.
- `error` — something failed. Always human-readable message.
- `done` — stream is finished. Frontend closes the EventSource connection.
- `ping` — keepalive event sent every 120s if no activity. Frontend ignores it.

Each session gets its own in-memory `asyncio.Queue` keyed by `session_id` in `sse_service.py`. SSE endpoint reads from this queue and yields events. Clean up the queue after the stream ends.

---

## Database Schema (Supabase)

**reports table** — every completed report. Stores session_id, query, mode, query_type, overall_confidence, created_at, and the full report as a JSONB blob. Store report as one JSONB blob — do not normalise individual claims into rows.

**monitors table** — scheduled recurring queries. Stores the query, mode, interval_hours, last_run, next_run, and active flag.

> The `diffs` table and full APScheduler integration are planned but not yet implemented. Monitor scheduling via `/api/monitor` saves to Supabase but re-query automation requires external triggering (e.g. a cron job calling `/api/query`).

---

## UI Layout

Single page. No routing needed. Panels appear progressively as the query runs.

**Top bar:** Logo (WebIntel), live status pill, History button, API docs link

**Query bar:** Full-width text input + Mode dropdown + Query Type dropdown + Run button. Optional entity input (compare mode) and URL input (summarise_url mode) slide in below.

**Three-column live panel (appears when query starts):**
- Left — Agent Trace: live step log, each step marked pending / active (pulsing cyan) / done (green)
- Center — Extracted Claims: cards appear one by one as claims are verified. Each card shows claim text, confidence bar, percentage, source count, conflict warning if applicable
- Right — Sources Visited: list with trust tier badge (color-coded), agreement/conflict counts, discarded marker

**Bottom row (appears on completion):**
- Left — Conflict Log: each conflict with full resolution explanation
- Right — Citation Graph: Chart.js bar chart showing agreements vs conflicts per source domain

**For Compare mode:** Center panel becomes a comparison table instead of claim cards

**For Track mode:** Center panel shows diff view — green for new, red for removed, amber for confidence shifts

**Footer / Report Summary Bar:** Overall confidence, total claims, sources, conflicts; Export JSON, Monitor, Share buttons

**History sidebar:** Slides in from right. Shows past queries with timestamps and confidence scores, clickable to reload any report.

---

## Critical Implementation Rules

**Never block the event loop.** Groq's Python SDK is synchronous. Every Groq call is wrapped in `asyncio.get_running_loop().run_in_executor(None, _call)` in `llm_service.py` so it doesn't freeze FastAPI's event loop and kill SSE streaming.

**Always return JSON from Groq.** Every single prompt must end with a hard instruction: return only raw valid JSON, no markdown fences, no preamble, no explanation. Parse with `json.loads()` and always catch parse exceptions. `call_llm_json()` will make a second cleanup attempt if the first parse fails.

**Parallel agents must use return_exceptions=True.** One failing Tavily call must never crash the whole pipeline. Continue with whatever succeeded and log the failure in the trace.

**SSE needs no-cache headers.** `Cache-Control: no-cache`, `X-Accel-Buffering: no`, and `Connection: keep-alive` are set on every `StreamingResponse` or some browsers and reverse proxies will buffer the stream silently.

**CORS middleware must be added before mounting static files.** Middleware order matters in FastAPI — see `main.py`.

**Lazy Supabase init.** `supabase_service.get_client()` returns `None` gracefully if env vars are missing. The app runs fully without Supabase — reports just won't be persisted.

---

## Environment Variables Needed

```
GROQ_API_KEY         ← Groq API key (required)
TAVILY_API_KEY       ← Tavily search API key (required)
SUPABASE_URL         ← Supabase project URL (optional — disables persistence if missing)
SUPABASE_KEY         ← Supabase anon/service key (optional)
CORS_ORIGINS         ← Comma-separated allowed origins (default: *)
ENVIRONMENT          ← development | production
```

---

## Running Locally

```bash
# From the project root
pip install -r requirements.txt

# Set env vars (copy .env and fill in keys)
cp .env.example .env

# Start backend (serves frontend too)
cd webintel
uvicorn backend.main:app --reload --port 8000

# Open browser
open http://localhost:8000
```

Or use the provided start script:
```bash
bash start.sh
```

---

## Demo Queries (Prepare These Before Presenting)

**Query 1 — Verification demo**
"What is the current market cap of Reliance Industries?"
Mode: Research | Type: Single
Shows: multi-source verification, NSE vs BSE variance, conflict detection, resolution via majority vote

**Query 2 — Compare demo (most visually impressive)**
"Compare Jio vs Airtel vs Vi — subscribers, revenue, and 5G coverage"
Mode: Research | Type: Compare
Entities: Jio, Airtel, Vi
Shows: parallel agent batches per entity, comparison table, citation graph

**Query 3 — Autonomy demo**
"What are the latest AI regulations being considered in India?"
Mode: Deep Dive | Type: Single
Shows: agent re-querying after low-confidence first pass, confidence scores updating live, government + news sources triangulating

---

*WebIntel — Antigravity*
