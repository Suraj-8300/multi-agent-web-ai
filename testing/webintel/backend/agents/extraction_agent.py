"""Extraction Agent — pulls structured claims from raw search content."""
import asyncio
from ..services.llm_service import call_llm_json
from ..models.models import SearchResult, Claim
from ..utils.trust_scorer import get_domain
from datetime import datetime


async def extract_claims_from_batch(results: list[SearchResult], original_query: str) -> list[Claim]:
    """Extract claims from all results. Process in parallel batches."""
    tasks = [_extract_from_one(r, original_query) for r in results]
    claim_batches = await asyncio.gather(*tasks, return_exceptions=True)

    all_claims = []
    for batch in claim_batches:
        if isinstance(batch, Exception):
            print(f"[ExtractionAgent] Extraction error: {batch}")
            continue
        all_claims.extend(batch)

    return all_claims


async def _extract_from_one(result: SearchResult, query: str) -> list[Claim]:
    """Extract factual claims from a single search result."""
    if not result.content or len(result.content) < 50:
        return []

    prompt = f"""
You are a fact extraction agent. Extract ALL relevant factual claims from the content below that relate to the query: "{query}"

Source URL: {result.url}

Content:
{result.content[:3000]}

Extract at most 5 key factual claims. Each claim must be:
- A specific, atomic, verifiable fact (not an opinion)
- Directly relevant to the query
- Accompanied by the source URL

Return a JSON array:
[
  {{
    "statement": "The factual claim here",
    "source_url": "{result.url}",
    "timestamp": "ISO timestamp if mentioned, else empty string"
  }},
  ...
]
Return ONLY the JSON array.
"""

    data = await call_llm_json(prompt, model="llama-3.1-8b-instant")
    claims = []

    if isinstance(data, list):
        for item in data:
            if isinstance(item, dict) and "statement" in item:
                claims.append(Claim(
                    statement=str(item.get("statement", "")),
                    source_url=str(item.get("source_url", result.url)),
                    timestamp=str(item.get("timestamp", "")),
                    confidence_score=0.5,
                    status="pending",
                ))

    return claims
