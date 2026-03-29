"""WebIntel — FastAPI Backend
Full multi-agent web intelligence system with SSE streaming.
"""
import asyncio
import json
import uuid
import os
from contextlib import asynccontextmanager
from datetime import datetime

from dotenv import load_dotenv
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "../../.env"))

from fastapi import FastAPI, HTTPException, BackgroundTasks, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, HTMLResponse, JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles

from .models.models import QueryRequest, QueryMode, QueryType, MonitorRequest
from .services import sse_service, supabase_service
from .agents import planner, search_agent, extraction_agent, verification_agent, report_agent

# ─────────────────────── Lifespan ────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    print("✅ WebIntel backend started")
    yield
    print("🛑 WebIntel backend shutting down")

# ─────────────────────── App ─────────────────────────────────
app = FastAPI(
    title="WebIntel API",
    description="Autonomous Multi-Agent Web Intelligence System",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS — must come before static files mount
origins = os.environ.get("CORS_ORIGINS", "*").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve frontend static files
# The frontend directory is at webintel/frontend/
frontend_path = os.path.join(os.path.dirname(__file__), "../../webintel/frontend")
if not os.path.exists(frontend_path):
    # Fallback: try relative to backend
    frontend_path = os.path.join(os.path.dirname(__file__), "../frontend")

if os.path.exists(frontend_path):
    # Serve css/ and js/ under their explicit root paths to match index.html
    css_path = os.path.join(frontend_path, "css")
    js_path = os.path.join(frontend_path, "js")
    if os.path.exists(css_path):
        app.mount("/css", StaticFiles(directory=css_path), name="css")
    if os.path.exists(js_path):
        app.mount("/js", StaticFiles(directory=js_path), name="js")
    
    # Keep /static fallback
    app.mount("/static", StaticFiles(directory=frontend_path), name="static")


# ─────────────────────── Orchestration ───────────────────────
async def run_pipeline(session_id: str, request: QueryRequest):
    """Main orchestration pipeline — runs agents and pushes SSE events per step."""
    push = lambda etype, data: sse_service.push_event(session_id, etype, data)

    try:
        step = 0

        async def trace(msg: str):
            nonlocal step
            step += 1
            await push("trace", {"step": step, "message": msg, "timestamp": datetime.utcnow().isoformat()})

        await trace("🧠 Planning research strategy...")
        sub_queries = await planner.plan_query(
            request.query,
            request.mode,
            entities=request.entities if request.query_type == QueryType.compare else None,
        )
        await trace(f"📋 Generated {len(sub_queries)} targeted sub-queries")

        await trace("🔍 Dispatching parallel search agents...")
        mode_result_count = {
            QueryMode.quick: 3,
            QueryMode.fact_check: 4,
            QueryMode.research: 5,
            QueryMode.deep_dive: 7,
        }
        max_results = mode_result_count.get(request.mode, 5)

        # Handle summarise_url mode
        if request.query_type == QueryType.summarise_url and request.url:
            await trace(f"🌐 Fetching URL: {request.url}")
            url_result = await search_agent.fetch_url_content(request.url)
            search_results = [url_result] if url_result else []
        else:
            search_results = await search_agent.run_parallel_searches(sub_queries, max_results)

        await trace(f"✅ Retrieved {len(search_results)} unique sources")

        await trace("📝 Extracting factual claims from all sources...")
        raw_claims = await extraction_agent.extract_claims_from_batch(search_results, request.query)
        await trace(f"💡 Extracted {len(raw_claims)} raw claims")

        await trace("🔬 Verifying claims and scoring confidence...")
        verified_claims, sources = await verification_agent.verify_claims(raw_claims)

        # Push individual claim events as they stream in
        for claim in verified_claims:
            await push("claim", claim.model_dump())
            await asyncio.sleep(0.05)  # small delay for visual streaming effect

        await trace(f"✔️ Verified {len(verified_claims)} claims, detected {sum(1 for c in verified_claims if c.conflicting_sources)} conflicts")

        # Re-query if confidence too low
        requery_thresholds = {
            QueryMode.quick: None,
            QueryMode.fact_check: 0.60,
            QueryMode.research: 0.70,
            QueryMode.deep_dive: 0.80,
        }
        threshold = requery_thresholds.get(request.mode)
        if threshold and verified_claims:
            avg_conf = sum(c.confidence_score for c in verified_claims) / len(verified_claims)
            if avg_conf < threshold:
                await trace(f"⚠️ Confidence {avg_conf:.0%} below threshold. Launching re-query...")
                weak_claims = [c for c in verified_claims if c.confidence_score < threshold]
                requery_stmts = " ".join([c.statement[:80] for c in weak_claims[:3]])
                extra_queries = await planner.plan_query(
                    f"Verify and find more information about: {requery_stmts}",
                    QueryMode.research,
                )
                extra_results = await search_agent.run_parallel_searches(extra_queries[:3], 3)
                extra_claims_raw = await extraction_agent.extract_claims_from_batch(extra_results, request.query)
                extra_verified, extra_sources = await verification_agent.verify_claims(extra_claims_raw)

                verified_claims.extend(extra_verified)
                sources.extend(extra_sources)

                for claim in extra_verified:
                    await push("claim", claim.model_dump())
                    await asyncio.sleep(0.05)

                await trace(f"🔄 Re-query added {len(extra_verified)} additional claims")

        # Build compare table if needed
        compare_table_raw = None
        if request.query_type == QueryType.compare and request.entities:
            await trace("📊 Building comparison table...")
            compare_table_raw = await verification_agent.build_compare_table(
                verified_claims, request.entities, request.query
            )

        await trace("📄 Assembling final report...")
        report = await report_agent.generate_report(
            session_id=session_id,
            query=request.query,
            mode=request.mode.value,
            query_type=request.query_type.value,
            verified_claims=verified_claims,
            sources=sources,
            compare_table_raw=compare_table_raw,
        )

        # Save to Supabase
        asyncio.create_task(supabase_service.save_report(
            session_id=session_id,
            query=request.query,
            mode=request.mode.value,
            query_type=request.query_type.value,
            report=report.model_dump(),
            confidence=report.overall_confidence,
        ))

        await push("report", report.model_dump())
        await trace(f"🎉 Report complete! Overall confidence: {report.overall_confidence:.1f}%")
        await push("done", {"session_id": session_id})

    except Exception as e:
        import traceback
        traceback.print_exc()
        await push("error", {"message": f"Pipeline error: {str(e)}"})
        await push("done", {"session_id": session_id})


# ─────────────────────── Routes ──────────────────────────────
@app.get("/")
async def root():
    """Serve the frontend index.html."""
    # Try both possible frontend locations
    candidates = [
        os.path.join(os.path.dirname(__file__), "../../webintel/frontend/index.html"),
        os.path.join(os.path.dirname(__file__), "../frontend/index.html"),
    ]
    for path in candidates:
        if os.path.exists(path):
            return FileResponse(path, media_type="text/html")
    return HTMLResponse("""
        <html><body style="font-family:Inter,sans-serif;background:#080A12;color:#F0F4FF;display:grid;place-items:center;height:100vh;margin:0">
          <div style="text-align:center">
            <h1 style="font-size:32px;margin-bottom:8px">WebIntel API <span style="opacity:0.4">v1.0.0</span></h1>
            <p style="color:#94A3B8">Frontend not found. Visit <a href="/docs" style="color:#8B5CF6">/docs</a> for the API.</p>
          </div>
        </body></html>
    """, status_code=200)


@app.post("/api/query")
async def start_query(request: QueryRequest, background: BackgroundTasks):
    """Start a research query. Returns session_id to connect to /api/stream/{session_id}"""
    session_id = str(uuid.uuid4())
    sse_service.create_session(session_id)
    background.add_task(run_pipeline, session_id, request)
    return {"session_id": session_id, "status": "started"}


@app.get("/api/stream/{session_id}")
async def stream_events(session_id: str):
    """SSE endpoint — streams agent events for a given session."""
    queue = sse_service.get_queue(session_id)
    if not queue:
        raise HTTPException(status_code=404, detail="Session not found")

    async def event_generator():
        try:
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=120.0)
                    yield sse_service.format_sse(event["type"], event["data"])
                    if event["type"] == "done":
                        break
                except asyncio.TimeoutError:
                    yield sse_service.format_sse("ping", {"ts": datetime.utcnow().isoformat()})
        finally:
            sse_service.cleanup_session(session_id)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@app.get("/api/history")
async def get_history():
    """Get past research queries from Supabase."""
    history = await supabase_service.get_history(30)
    return {"history": history}


@app.get("/api/report/{session_id}")
async def get_report(session_id: str):
    """Retrieve a previously saved report."""
    report = await supabase_service.get_report_by_session(session_id)
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    return report


@app.post("/api/monitor")
async def create_monitor(req: MonitorRequest):
    """Schedule a recurring query monitor."""
    ok = await supabase_service.save_monitor(req.query, req.mode.value, req.interval_hours)
    return {"success": ok, "message": "Monitor scheduled" if ok else "Failed (Supabase not connected)"}


@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "version": "1.0.0",
        "groq": bool(os.environ.get("GROQ_API_KEY")),
        "tavily": bool(os.environ.get("TAVILY_API_KEY")),
        "supabase": bool(os.environ.get("SUPABASE_URL")),
    }


@app.get("/api/export/{session_id}")
async def export_json(session_id: str):
    """Export report as JSON file."""
    report = await supabase_service.get_report_by_session(session_id)
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    return JSONResponse(
        content=report,
        headers={"Content-Disposition": f"attachment; filename=webintel_{session_id[:8]}.json"},
    )
