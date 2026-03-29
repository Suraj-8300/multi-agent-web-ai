# GROQ.md — WebIntel
### Autonomous Multi-Agent Web Intelligence System
**Team:** Antigravity | **Hackathon:** 36 Hours

---

## What This System Is

WebIntel is NOT a chatbot. It is NOT a search engine.

It is a real-time reasoning and verification system. The user asks a question, and instead of answering from memory, the system autonomously dispatches multiple AI agents to search the web in parallel, extracts structured facts from everything it finds, cross-verifies those facts across sources, detects conflicts, resolves them with logic, and returns a confidence-scored structured report — all streamed live to the UI as it happens.

One-line identity: **WebIntel searches, verifies, and explains — using parallel agents, in real time.**

---

## Tech Stack

- **Backend:** FastAPI (Python 3.14+) with async/await throughout
- **LLM:** Groq API (`llama-3.3-70b-versatile`) — used for planning, extraction, verification, report generation. Lightning-fast inference.
- **Search:** Tavily API — AI-optimized search that returns clean content + URLs, no raw scraping needed
- **Streaming:** Server-Sent Events (SSE) — streams live agent steps from backend to frontend
- **Database:** Supabase (Postgres) — stores reports, query history, scheduled monitor jobs
- **Frontend:** Vanilla HTML + CSS + JavaScript (no framework)
- **Frontend Charts:** Chart.js — for citation graph and confidence visualization
- **Deploy:** Backend on Railway or Render, Frontend served via FastAPI /static

---

## Python 3.14 Compatibility Notes

> **Critical:** Python 3.14 removed `asyncio.get_event_loop()` from all non-main-thread contexts.
> All blocking I/O (Groq SDK, Tavily SDK, Supabase SDK — all synchronous) must be run in an executor
> using `asyncio.get_running_loop().run_in_executor(None, fn)` — never `get_event_loop()`.

The codebase handles this correctly in all service files:
- `llm_service.py` — Groq call wrapped with `get_running_loop().run_in_executor`
- `tavily_service.py` — Tavily call wrapped identically
- `supabase_service.py` — All DB calls wrapped with shared `_run(fn)` helper
- `search_agent.py` — Uses `httpx` async client natively (no executor needed)

---

## Project File Structure

```
webintel/
├── backend/
│   ├── main.py                  ← FastAPI app, all routes, SSE endpoint
│   ├── agents/
│   │   ├── planner.py           ← Breaks query into sub-tasks using Groq
│   │   ├── search_agent.py      ← Runs parallel searches via Tavily
│   │   ├── extraction_agent.py  ← Pulls structured claims from raw content
│   │   ├── verification_agent.py← Compares claims, scores confidence, detects conflicts
│   │   └── report_agent.py      ← Assembles final structured output
│   ├── services/
│   │   ├── llm_service.py       ← Single wrapper for all Groq LLM calls
│   │   ├── tavily_service.py    ← Tavily search wrapper
│   │   ├── supabase_service.py  ← DB read/write helpers
│   │   └── sse_service.py       ← In-memory session queue for SSE streaming
│   ├── utils/
│   │   ├── trust_scorer.py      ← Assigns trust tier to domains (hardcoded list)
│   │   └── conflict_resolver.py ← Conflict resolution logic
│   └── models/
│       └── models.py            ← All Pydantic models (requests, claims, reports)
├── frontend/
│   ├── index.html               ← Single page app shell
│   ├── css/
│   │   └── main.css             ← All styles
│   └── js/
│       └── app.js               ← Main controller, SSE, rendering
├── requirements.txt
└── supabase_schema.sql
```

---

## How the System Works (Full Flow)

### Step 1 — Query Planning
User submits a query with a mode and query type. The Planner Agent calls Groq with the query and asks it to decompose it into N focused sub-queries, each assigned a source type (news, official, academic, financial). The number of sub-queries depends on the mode — 3 for Quick, up to 15 for Deep Dive.

### Step 2 — Parallel Search
All sub-queries are dispatched simultaneously using `asyncio.gather`. Each Search Agent calls Tavily with its specific sub-query and returns raw content + source URLs. Because they run in parallel, total time equals the slowest agent, not the sum of all agents.

### Step 3 — Claim Extraction
The Extraction Agent calls Groq on all collected raw content and asks it to pull out structured, atomic facts. Each claim comes with the source URL it was pulled from and a timestamp. Output is always a clean list of `{claim, source_url, timestamp}` objects.

### Step 4 — Verification
The Verification Agent groups similar claims from different sources, compares them, detects conflicts, and scores confidence. If confidence falls below the mode's threshold, it triggers a re-query.

### Step 5 — Report Generation
The Report Agent assembles everything into the final structured output.

### Step 6 — Streaming to UI
Every step pushes events to an in-memory SSE queue tied to the session ID. The frontend connects to `/stream/{session_id}` via EventSource and receives live updates.

---

## Parallel Agent Architecture

The Planner produces a list of sub-queries. The backend runs all of them at once using `asyncio.gather`. Each sub-query is a separate async task hitting Tavily with a different focused query.

**One agent failing must never stop the others.** Always use `return_exceptions=True` in gather calls.

Agent roles:
- **News Agent** — targets recent articles, media coverage
- **Official Agent** — targets government sites, company pages
- **Academic Agent** — targets encyclopedias, research content
- **Financial Agent** — targets market data

---

## Verification Logic

### Conflict Detection
- **Numeric claims:** more than 3% variance = conflict
- **Factual claims:** directly contradictory statements = conflict
- **Same domain:** ignore duplicates

### Confidence Scoring (0–100)
- 3+ high-trust sources agree → 90+
- Mixed trust → 60–80
- Active conflict → below 60
- Single source → cap at 55

### Re-query Threshold
| Mode | Re-query if confidence below |
|---|---|
| quick | Never |
| fact_check | 60% |
| research | 70% |
| deep_dive | 80% |

---

## Source Trust System

**High trust (85–95):** `.gov.in`, `nseindia.com`, `bseindia.com`, `bloomberg.com`, `reuters.com`, `apnews.com`, `who.int`, `un.org`

**Medium trust (55–70):** `economictimes.indiatimes.com`, `livemint.com`, `thehindu.com`, `bbc.com`, `techcrunch.com`, `forbes.com`, `wikipedia.org`

**Low trust (25–40):** `reddit.com`, `quora.com`, `medium.com`, `twitter.com`

**Unknown:** Default 45. Sources below 25 are auto-discarded but shown in UI.

---

## Output Data Structure

Every response from every Groq call must be valid JSON. No markdown, no explanation text. Enforced in every prompt.

The final report contains:
- `query`, `query_type`, `mode`
- `verified_claims` — array with claim, confidence, sources, conflict detail, resolution, status
- `sources` — all sources with trust tier, score, agreement/conflict counts
- `overall_confidence` — single 0–100 number
- `compare_table` — populated for compare mode
- `diff` — populated for track mode
- `total_sources_visited`, `conflicts_detected`, `conflicts_resolved`
- `generated_at` — ISO timestamp

---

## Modes

| Mode | Sub-queries | Re-query threshold | Speed |
|---|---|---|---|
| quick | 3 | Never | ~5 sec |
| fact_check | 4 | < 60% | ~10 sec |
| research | 8 | < 70% | ~20 sec |
| deep_dive | 15 | < 80% | ~45 sec |

---

## SSE Event Types

- `trace` — one agent step completed
- `claim` — a single verified claim (pushed immediately, not batched)
- `report` — complete final report object
- `error` — human-readable error message
- `done` — stream finished, frontend closes EventSource

---

## Database Schema (Supabase)

**reports table** — session_id, query, mode, query_type, report (JSONB), overall_confidence, created_at

**monitors table** — query, mode, interval_hours, last_run, next_run, active

---

## Environment Variables

```
GROQ_API_KEY=gsk_...
TAVILY_API_KEY=tvly-...
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_KEY=eyJhbGci...
CORS_ORIGINS=*
ENVIRONMENT=development
```

---

## Running the System

```bash
# From /home/suraj/Desktop/testing/
./start.sh
```

Then open: http://localhost:8000

API docs: http://localhost:8000/docs

---

## Critical Implementation Rules

**Never block the event loop.** Groq, Tavily, and Supabase SDKs are all synchronous. Always wrap them in `asyncio.get_running_loop().run_in_executor(None, fn)`.

**Always return JSON from Groq.** Every prompt ends with: "Return only raw valid JSON." Parse with `json.loads()` and always catch parse exceptions.

**Python 3.14:** Use `asyncio.get_running_loop()`. `asyncio.get_event_loop()` is removed.

**Parallel agents:** `return_exceptions=True`. One failing Tavily call must never crash the pipeline.

**SSE headers:** `Cache-Control: no-cache` and `X-Accel-Buffering: no` on every StreamingResponse.

**CORS before static files.** Middleware order matters in FastAPI.

---

## Demo Queries

**Query 1 — Verification demo**
"What is the current market cap of Reliance Industries?"
Mode: Research | Type: Single

**Query 2 — Compare demo**
"Compare Jio vs Airtel vs Vi — subscribers, revenue, and 5G coverage"
Mode: Research | Type: Compare

**Query 3 — Autonomy demo**
"What are the latest AI regulations being considered in India?"
Mode: Deep Dive | Type: Single

---

*WebIntel — Antigravity*
