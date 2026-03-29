"""Conflict detection and resolution logic."""
from typing import List, Tuple
from ..models.models import Claim


def detect_numeric_conflict(val1: str, val2: str, threshold: float = 0.03) -> bool:
    """Returns True if two numeric strings differ by more than threshold %."""
    import re
    nums1 = re.findall(r"[\d,]+\.?\d*", val1.replace(",", ""))
    nums2 = re.findall(r"[\d,]+\.?\d*", val2.replace(",", ""))
    if not nums1 or not nums2:
        return False
    try:
        n1 = float(nums1[0].replace(",", ""))
        n2 = float(nums2[0].replace(",", ""))
        if n1 == 0 and n2 == 0:
            return False
        avg = (abs(n1) + abs(n2)) / 2
        if avg == 0:
            return False
        variance = abs(n1 - n2) / avg
        return variance > threshold
    except Exception:
        return False


def resolve_conflict(claim1: Claim, claim2: Claim, trust_scores: dict) -> Tuple[Claim, str]:
    """
    Resolve conflict between two claims.
    Returns (winning_claim, resolution_method).
    Priority: official source > majority > recency
    """
    score1 = trust_scores.get(claim1.source_url, 45)
    score2 = trust_scores.get(claim2.source_url, 45)

    # Rule 1: High-trust (official) source wins
    if score1 > 84 and score2 <= 84:
        return claim1, "official_source_priority"
    if score2 > 84 and score1 <= 84:
        return claim2, "official_source_priority"

    # Rule 2: Higher trust score wins
    if score1 > score2 + 10:
        return claim1, "trust_score_majority"
    if score2 > score1 + 10:
        return claim2, "trust_score_majority"

    # Rule 3: Most recent timestamp wins
    if claim1.timestamp and claim2.timestamp:
        if claim1.timestamp > claim2.timestamp:
            return claim1, "recency"
        else:
            return claim2, "recency"

    # Rule 4: Unresolved
    claim1.status = "unresolved"
    return claim1, "unresolved"


def compute_confidence(claim: Claim, all_sources_trust: dict) -> float:
    """Compute a confidence score 0-100 for a claim."""
    supporting = claim.supporting_sources
    conflicting = claim.conflicting_sources

    if not supporting:
        return 30.0

    # Get trust scores
    trust_values = [all_sources_trust.get(url, 45) for url in supporting]
    avg_trust = sum(trust_values) / len(trust_values)

    # Base score from trust
    base = avg_trust * 0.7

    # Boost for multiple sources
    if len(supporting) >= 3:
        base += 20
    elif len(supporting) == 2:
        base += 10
    else:
        base = min(base, 55)  # Single source capped at 55

    # Penalty for conflicts
    if conflicting:
        base -= 20

    # Clamp
    return round(max(0.0, min(100.0, base)), 1)
