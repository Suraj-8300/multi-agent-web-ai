"""Report Agent — assembles final structured report."""
from ..models.models import FinalReport, Claim, SourceInfo, CompareRow, CompareCell, DiffItem
from datetime import datetime


async def generate_report(
    session_id: str,
    query: str,
    mode: str,
    query_type: str,
    verified_claims: list[Claim],
    sources: list[SourceInfo],
    compare_table_raw: list[dict] | None = None,
    previous_claims: list[Claim] | None = None,
) -> FinalReport:
    """Assemble the final report from all agent outputs."""

    # Overall confidence = average of all claim confidences
    if verified_claims:
        overall_conf = sum(c.confidence_score for c in verified_claims) / len(verified_claims)
    else:
        overall_conf = 0.0

    # Count conflicts
    conflicts_detected = sum(1 for c in verified_claims if c.conflicting_sources)
    conflicts_resolved = sum(1 for c in verified_claims if c.status == "verified" and c.conflicting_sources)

    # Build compare table
    compare_table = []
    if compare_table_raw:
        for row in compare_table_raw:
            cells = [
                CompareCell(
                    entity=str(cell.get("entity", "")),
                    value=str(cell.get("value", "")),
                    confidence=float(cell.get("confidence", 0.5)),
                    sources=list(cell.get("sources", [])),
                )
                for cell in row.get("cells", [])
            ]
            compare_table.append(CompareRow(
                criterion=str(row.get("criterion", "")),
                cells=cells,
            ))

    # Build diff for track mode
    diff = []
    if previous_claims and query_type == "track":
        prev_statements = {c.statement: c for c in previous_claims}
        curr_statements = {c.statement: c for c in verified_claims}

        for stmt, claim in curr_statements.items():
            if stmt not in prev_statements:
                diff.append(DiffItem(type="added", claim=stmt, new_confidence=claim.confidence_score))
            else:
                prev = prev_statements[stmt]
                if abs(claim.confidence_score - prev.confidence_score) > 0.1:
                    diff.append(DiffItem(
                        type="changed", claim=stmt,
                        old_confidence=prev.confidence_score,
                        new_confidence=claim.confidence_score,
                    ))

        for stmt in prev_statements:
            if stmt not in curr_statements:
                diff.append(DiffItem(type="removed", claim=stmt, old_confidence=prev_statements[stmt].confidence_score))

    return FinalReport(
        session_id=session_id,
        query=query,
        query_type=query_type,
        mode=mode,
        verified_claims=verified_claims,
        sources=sources,
        overall_confidence=round(overall_conf * 100, 1),
        compare_table=compare_table,
        diff=diff,
        total_sources_visited=len(sources),
        conflicts_detected=conflicts_detected,
        conflicts_resolved=conflicts_resolved,
        generated_at=datetime.utcnow().isoformat(),
    )
