"""Search Agent — runs parallel Tavily searches for all sub-queries.

One failing search never stops the others: asyncio.gather(..., return_exceptions=True).
"""
import asyncio
import httpx
from ..services.tavily_service import search
from ..models.models import SubQuery, SearchResult
from ..utils.trust_scorer import get_domain


async def run_parallel_searches(
    sub_queries: list[SubQuery],
    max_results_per_query: int = 5,
) -> list[SearchResult]:
    """Run all sub-queries in parallel. One failure never stops the rest."""
    tasks = [
        search(sq.query, sq.source_type, max_results_per_query)
        for sq in sub_queries
    ]
    results_nested = await asyncio.gather(*tasks, return_exceptions=True)

    all_results: list[SearchResult] = []
    seen_urls: set[str] = set()

    for i, result in enumerate(results_nested):
        if isinstance(result, BaseException):
            print(f"[SearchAgent] Sub-query {i} failed: {result}")
            continue
        for r in result:
            if r.url not in seen_urls:
                seen_urls.add(r.url)
                all_results.append(r)

    return all_results


async def fetch_url_content(url: str) -> SearchResult | None:
    """Fetch content from a specific URL (for summarise_url mode).

    Uses httpx async client — no executor needed.
    """
    try:
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
            resp = await client.get(
                url,
                headers={"User-Agent": "Mozilla/5.0 WebIntel/1.0"},
            )
            text = resp.text[:8000]
            return SearchResult(
                url=url,
                content=text,
                title="",
                domain=get_domain(url),
            )
    except Exception as e:
        print(f"[SearchAgent] URL fetch failed for {url}: {e}")
        return None
