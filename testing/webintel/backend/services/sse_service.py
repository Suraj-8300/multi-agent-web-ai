"""SSE session queue service — one asyncio Queue per session."""
import asyncio
from typing import Dict
import json

_queues: Dict[str, asyncio.Queue] = {}


def create_session(session_id: str) -> asyncio.Queue:
    q = asyncio.Queue()
    _queues[session_id] = q
    return q


def get_queue(session_id: str) -> asyncio.Queue | None:
    return _queues.get(session_id)


async def push_event(session_id: str, event_type: str, data: any):
    q = _queues.get(session_id)
    if q:
        await q.put({"type": event_type, "data": data})


def cleanup_session(session_id: str):
    _queues.pop(session_id, None)


def format_sse(event_type: str, data: any) -> str:
    payload = json.dumps(data, default=str)
    return f"event: {event_type}\ndata: {payload}\n\n"
