"""Verification Agent — groups claims, scores confidence, detects conflicts."""
import asyncio
from ..services.llm_service import call_llm_json
from ..models.models import Claim, SourceInfo
from ..utils.trust_scorer import score_domain, should_discard
from ..utils.conflict_resolver import compute_confidence


async def verify_claims(claims: list[Claim]) -> tuple[list[Claim], list[SourceInfo]]:
    """
    1. Build source trust map
    2. Group similar claims
    3. Detect conflicts
    4. Compute confidence scores
    5. Return (verified_claims, source_infos)
    """
    if not claims:
        return [], []

    # Build source trust map
    source_map: dict[str, SourceInfo] = {}
    trust_scores: dict[str, int] = {}

    for claim in claims:
        url = claim.source_url
        if url not in source_map:
            tier, score = score_domain(url)
            from ..utils.trust_scorer import get_domain
            domain = get_domain(url)
            source_map[url] = SourceInfo(
                url=url,
                domain=domain,
                trust_tier=tier,
                trust_score=score,
                discarded=should_discard(score),
            )
            trust_scores[url] = score

    # Filter out discarded sources' claims
    valid_claims = [c for c in claims if not source_map.get(c.source_url, SourceInfo(url="", domain="")).discarded]

    if not valid_claims:
        valid_claims = claims  # fallback: keep all if all discarded

    # Group similar claims using LLM
    grouped = await _group_similar_claims(valid_claims)

    # Process each group
    verified_claims = []
    for group in grouped:
        if not group:
            continue

        # Deduplicate by source domain
        seen_domains = set()
        deduped = []
        for claim in group:
            from ..utils.trust_scorer import get_domain
            domain = get_domain(claim.source_url)
            if domain not in seen_domains:
                seen_domains.add(domain)
                deduped.append(claim)

        # Detect conflict within group
        if len(deduped) > 1:
            conflict = await _detect_conflict(deduped)
        else:
            conflict = False

        # Build supporting / conflicting lists
        urls = [c.source_url for c in deduped]
        representative = deduped[0]

        if conflict:
            # Split into two halves as conflicting groups
            half = len(deduped) // 2
            supporting = [c.source_url for c in deduped[:half or 1]]
            conflicting = [c.source_url for c in deduped[half:]]
            representative.supporting_sources = supporting
            representative.conflicting_sources = conflicting
            representative.status = "conflict"
            representative.conflict_detail = "Sources disagree on this claim."

            # Try resolution
            if len(supporting) > len(conflicting):
                representative.status = "verified"
                representative.resolution_method = "majority_agreement"
            elif any(trust_scores.get(u, 0) > 84 for u in supporting):
                representative.status = "verified"
                representative.resolution_method = "official_source_priority"
            else:
                representative.status = "unresolved"
                representative.resolution_method = "unresolved"

            # Update source conflict counts
            for u in supporting:
                if u in source_map:
                    source_map[u].agreement_count += 1
            for u in conflicting:
                if u in source_map:
                    source_map[u].conflict_count += 1
        else:
            representative.supporting_sources = urls
            representative.conflicting_sources = []
            representative.status = "verified"

            for u in urls:
                if u in source_map:
                    source_map[u].agreement_count += 1

        # Compute confidence
        score = compute_confidence(representative, trust_scores)
        representative.confidence_score = score / 100.0  # normalize 0-1

        verified_claims.append(representative)

    # Sort by confidence desc
    verified_claims.sort(key=lambda c: c.confidence_score, reverse=True)

    sources = list(source_map.values())
    return verified_claims, sources


async def _group_similar_claims(claims: list[Claim]) -> list[list[Claim]]:
    """Use LLM to group similar/related claims together."""
    if len(claims) <= 3:
        return [[c] for c in claims]

    statements = [{"idx": i, "statement": c.statement[:200]} for i, c in enumerate(claims)]

    prompt = f"""
You are a claim grouping agent. Group these claims by similarity — claims that talk about the same fact should be in the same group.

Claims:
{statements}

Return a JSON array of arrays showing which indices belong together:
[[0, 3, 7], [1, 4], [2], [5, 6], ...]

Each index must appear exactly once. Return ONLY the JSON array.
"""

    result = await call_llm_json(prompt, model="llama-3.1-8b-instant")
    groups: list[list[Claim]] = []

    if isinstance(result, list):
        used = set()
        for group_indices in result:
            if not isinstance(group_indices, list):
                continue
            group = []
            for idx in group_indices:
                if isinstance(idx, int) and 0 <= idx < len(claims) and idx not in used:
                    group.append(claims[idx])
                    used.add(idx)
            if group:
                groups.append(group)

        # Add any missed claims as singletons
        for i, claim in enumerate(claims):
            if i not in used:
                groups.append([claim])
    else:
        groups = [[c] for c in claims]

    return groups


async def _detect_conflict(claims: list[Claim]) -> bool:
    """Check if claims in a group contradict each other."""
    if len(claims) < 2:
        return False

    statements = "\n".join([f"- {c.statement}" for c in claims[:5]])

    prompt = f"""
Do these statements contradict each other or present conflicting information?

{statements}

Answer with ONLY a JSON object: {{"conflict": true}} or {{"conflict": false}}
"""

    result = await call_llm_json(prompt, model="llama-3.1-8b-instant")
    if isinstance(result, dict):
        return bool(result.get("conflict", False))
    return False


async def build_compare_table(claims: list[Claim], entities: list[str], original_query: str) -> list[dict]:
    """Build a comparison table for compare mode."""
    statements = [c.statement for c in claims[:40]]

    prompt = f"""
You are a comparison analyst. Given these facts, build a comparison table for: {entities}
Query: "{original_query}"

Facts collected:
{chr(10).join(statements)}

Return a JSON array of comparison rows:
[
  {{
    "criterion": "criteria name (e.g. Revenue, Subscribers, 5G Coverage)",
    "cells": [
      {{"entity": "Entity1", "value": "value here", "confidence": 0.8, "sources": []}},
      {{"entity": "Entity2", "value": "value here", "confidence": 0.7, "sources": []}}
    ]
  }},
  ...
]
Return ONLY the JSON array.
"""

    result = await call_llm_json(prompt, model="llama-3.1-8b-instant")
    if isinstance(result, list):
        return result
    return []
