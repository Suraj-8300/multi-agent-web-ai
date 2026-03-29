"""Planner Agent — decomposes user query into sub-queries using the LLM."""
from ..services.llm_service import call_llm_json
from ..models.models import SubQuery, QueryMode

MODE_SUBQUERY_COUNT = {
    QueryMode.quick: 3,
    QueryMode.fact_check: 4,
    QueryMode.research: 8,
    QueryMode.deep_dive: 15,
}

SOURCE_TYPES = ["news", "official", "academic", "financial", "general"]


async def plan_query(query: str, mode: QueryMode, entities: list[str] | None = None) -> list[SubQuery]:
    n = MODE_SUBQUERY_COUNT.get(mode, 5)

    if entities:
        entity_str = ", ".join(entities)
        prompt = f"""
You are a research planner. The user wants to COMPARE these entities: {entity_str}
Based on the query: "{query}"

Generate {n} focused search sub-queries covering all entities.
Each sub-query should target a specific entity and aspect (revenue, subscribers, etc.).

Return a JSON array like:
[
  {{"query": "specific search query", "source_type": "news|official|academic|financial|general"}},
  ...
]
Return ONLY the JSON array.
"""
    else:
        prompt = f"""
You are a research planner. The user query is: "{query}"

Decompose this into {n} targeted search sub-queries.
Use source types: news (recent articles), official (gov/company sites), academic (reference/encyclopedias), financial (market data), general.

Return a JSON array like:
[
  {{"query": "specific search query", "source_type": "news|official|academic|financial|general"}},
  ...
]
Return ONLY the JSON array.
"""

    result = await call_llm_json(prompt)
    sub_queries = []

    if isinstance(result, list):
        for item in result:
            if isinstance(item, dict) and "query" in item:
                sub_queries.append(SubQuery(
                    query=str(item["query"]),
                    source_type=str(item.get("source_type", "general")),
                ))
    
    # Fallback: if LLM failed, generate basic sub-queries
    if not sub_queries:
        sub_queries = [
            SubQuery(query=f"{query} latest news", source_type="news"),
            SubQuery(query=f"{query} official information", source_type="official"),
            SubQuery(query=f"{query} detailed analysis", source_type="general"),
        ]

    return sub_queries[:n]
