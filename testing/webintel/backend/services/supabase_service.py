"""Supabase persistence service.

Python 3.14 compatible: uses asyncio.get_running_loop() instead of deprecated get_event_loop().
All DB operations are wrapped in run_in_executor so they never block FastAPI's async event loop.
"""
import os
import asyncio
from datetime import datetime, timedelta

_client = None


def get_client():
    """Lazy-init Supabase client. Returns None if env vars are missing or init fails."""
    global _client
    if _client is None:
        try:
            from supabase import create_client
            url = os.environ.get("SUPABASE_URL", "")
            key = os.environ.get("SUPABASE_KEY", "")
            if url and key:
                _client = create_client(url, key)
                print("[Supabase] Client initialized successfully")
            else:
                print("[Supabase] SUPABASE_URL or SUPABASE_KEY not set — running without persistence")
        except Exception as e:
            print(f"[Supabase] Init failed: {e}")
    return _client


async def _run(fn):
    """Run a synchronous Supabase call in an executor thread."""
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, fn)


async def save_report(
    session_id: str,
    query: str,
    mode: str,
    query_type: str,
    report: dict,
    confidence: float,
) -> bool:
    client = get_client()
    if not client:
        return False

    def _save():
        try:
            client.table("reports").insert({
                "session_id": session_id,
                "query": query,
                "mode": mode,
                "query_type": query_type,
                "report": report,
                "overall_confidence": confidence,
                "created_at": datetime.utcnow().isoformat(),
            }).execute()
            return True
        except Exception as e:
            print(f"[Supabase] save_report error: {e}")
            return False

    return await _run(_save)


async def get_history(limit: int = 20) -> list:
    client = get_client()
    if not client:
        return []

    def _get():
        try:
            res = (
                client.table("reports")
                .select("session_id, query, mode, query_type, overall_confidence, created_at")
                .order("created_at", desc=True)
                .limit(limit)
                .execute()
            )
            return res.data or []
        except Exception as e:
            print(f"[Supabase] get_history error: {e}")
            return []

    return await _run(_get)


async def get_report_by_session(session_id: str) -> dict | None:
    client = get_client()
    if not client:
        return None

    def _get():
        try:
            res = (
                client.table("reports")
                .select("*")
                .eq("session_id", session_id)
                .single()
                .execute()
            )
            return res.data
        except Exception as e:
            print(f"[Supabase] get_report_by_session error: {e}")
            return None

    return await _run(_get)


async def save_monitor(query: str, mode: str, interval_hours: int) -> bool:
    client = get_client()
    if not client:
        return False

    def _save():
        try:
            now = datetime.utcnow()
            client.table("monitors").insert({
                "query": query,
                "mode": mode,
                "interval_hours": interval_hours,
                "last_run": now.isoformat(),
                "next_run": (now + timedelta(hours=interval_hours)).isoformat(),
                "active": True,
            }).execute()
            return True
        except Exception as e:
            print(f"[Supabase] save_monitor error: {e}")
            return False

    return await _run(_save)
