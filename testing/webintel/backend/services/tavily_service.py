"""Tavily search service wrapper.

Python 3.14 compatible: uses asyncio.get_running_loop() instead of deprecated get_event_loop().
"""
import os
import asyncio
from tavily import TavilyClient
from ..models.models import SearchResult
from ..utils.trust_scorer import get_domain

_client: TavilyClient | None = None


def get_client() -> TavilyClient:
    global _client
    if _client is None:
        key = os.environ.get("TAVILY_API_KEY", "")
        if not key:
            raise RuntimeError("TAVILY_API_KEY environment variable is not set")
        _client = TavilyClient(api_key=key)
    return _client


async def search(query: str, source_type: str = "general", max_results: int = 5) -> list[SearchResult]:
    """Run a Tavily search and return structured results.

    Tavily SDK is synchronous — runs in executor to avoid blocking FastAPI's event loop.
    """
    client = get_client()

    topic_map = {
        "news": "news",
        "official": "general",
        "academic": "general",
        "financial": "general",
        "general": "general",
    }
    topic = topic_map.get(source_type, "general")

    def _search():
        try:
            response = client.search(
                query=query,
                search_depth="advanced",
                topic=topic,
                max_results=max_results,
                include_raw_content=True,
            )
            return response.get("results", [])
        except Exception as e:
            print(f"[Tavily] Search error for '{query}': {e}")
            return []

    loop = asyncio.get_running_loop()
    results = await loop.run_in_executor(None, _search)

    output = []
    for r in results:
        url = r.get("url", "")
        content = r.get("raw_content") or r.get("content", "")
        title = r.get("title", "")
        if url:
            output.append(SearchResult(
                url=url,
                content=content[:4000],  # limit content length per result
                title=title,
                domain=get_domain(url),
            ))
    return output
