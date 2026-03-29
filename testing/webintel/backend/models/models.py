from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from enum import Enum
from datetime import datetime


class QueryMode(str, Enum):
    quick = "quick"
    fact_check = "fact_check"
    research = "research"
    deep_dive = "deep_dive"


class QueryType(str, Enum):
    single = "single"
    compare = "compare"
    track = "track"
    summarise_url = "summarise_url"


class QueryRequest(BaseModel):
    query: str
    mode: QueryMode = QueryMode.research
    query_type: QueryType = QueryType.single
    entities: Optional[List[str]] = None  # for compare mode
    url: Optional[str] = None             # for summarise_url


class SubQuery(BaseModel):
    query: str
    source_type: str = "general"  # news | official | academic | financial | general


class SearchResult(BaseModel):
    url: str
    content: str
    title: str = ""
    domain: str = ""


class Claim(BaseModel):
    statement: str
    source_url: str
    timestamp: str = ""
    confidence_score: float = 0.5
    is_verified: bool = False
    status: str = "pending"  # verified | conflict | unresolved
    supporting_sources: List[str] = []
    conflicting_sources: List[str] = []
    conflict_detail: Optional[str] = None
    resolution_method: Optional[str] = None


class SourceInfo(BaseModel):
    url: str
    domain: str
    trust_tier: str = "unknown"  # high | medium | low | unknown
    trust_score: int = 45
    agreement_count: int = 0
    conflict_count: int = 0
    discarded: bool = False


class CompareCell(BaseModel):
    entity: str
    value: str
    confidence: float
    sources: List[str] = []


class CompareRow(BaseModel):
    criterion: str
    cells: List[CompareCell]


class DiffItem(BaseModel):
    type: str  # added | removed | changed
    claim: str
    old_confidence: Optional[float] = None
    new_confidence: Optional[float] = None


class FinalReport(BaseModel):
    session_id: str
    query: str
    query_type: str
    mode: str
    verified_claims: List[Claim] = []
    sources: List[SourceInfo] = []
    overall_confidence: float = 0.0
    compare_table: List[CompareRow] = []
    diff: List[DiffItem] = []
    total_sources_visited: int = 0
    conflicts_detected: int = 0
    conflicts_resolved: int = 0
    generated_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat())


class SSEEvent(BaseModel):
    type: str  # trace | claim | report | error | done
    data: Any
    session_id: str


class MonitorRequest(BaseModel):
    query: str
    mode: QueryMode = QueryMode.research
    interval_hours: int = 24
