import asyncio
import os
import re
import json
from dotenv import load_dotenv
from typing import List, Optional, Union
from pydantic import BaseModel, Field, TypeAdapter
from pydantic_ai import Agent, RunContext
from pydantic_ai.models.groq import GroqModel
from pydantic_graph import BaseNode, Graph, GraphRunContext, End

load_dotenv()

# 1. SETUP & MODELS
model = GroqModel('llama-3.3-70b-versatile')

# 2. DATA MODELS
class SearchTask(BaseModel):
    query: str
    status: str = "pending"
    raw_result: Optional[str] = None

class Claim(BaseModel):
    statement: str
    source_url: str
    confidence_score: float
    is_verified: bool = False

class AgentState(BaseModel):
    original_query: str
    tasks: List[SearchTask] = []
    extracted_claims: List[Claim] = []
    final_report: str = ""

# 3. LLAMA XML SANITIZER (The Fix for <function> tags)
def sanitize_llama_json(text: str) -> str:
    text = re.sub(r'<function.*?>', '', text)
    text = re.sub(r'</function>', '', text)
    match = re.search(r'([\[\{].*[\]\}])', text, re.DOTALL)
    return match.group(1) if match else text.strip()

# 4. AGENT DEFINITIONS (Using output_type for 2026 compatibility)
planner_agent = Agent(
    model,
    output_type=List[SearchTask], # CHANGED from result_type
    retries=3,
    system_prompt="You are a research planner. Return ONLY a JSON list of 3 search queries. No tags."
)

extractor_agent = Agent(
    model,
    output_type=List[Claim], # CHANGED from result_type
    retries=3,
    system_prompt="Extract 3 factual claims from the text as a JSON list. No tags."
)

fallback_agent = Agent(model)


# 5. GRAPH NODES
class PlannerNode(BaseNode[AgentState]):
    async def run(self, ctx: GraphRunContext[AgentState]) -> "SearchNode":
        print(f"--> Planning: {ctx.state.original_query}")
        try:
            result = await planner_agent.run(ctx.state.original_query)
            ctx.state.tasks = result.output
        except Exception as e:
            print(f"Fallback triggered for Planner due to: {e}")
            raw = await fallback_agent.run(f"Break this into 3 search queries as a JSON list of objects with a 'query' key (e.g. [{{\"query\": \"topic 1\"}}]), no xml or markdown tags: {ctx.state.original_query}")
            clean = sanitize_llama_json(raw.output)
            ctx.state.tasks = TypeAdapter(List[SearchTask]).validate_json(clean)
        return SearchNode()

class SearchNode(BaseNode[AgentState]):
    async def run(self, ctx: GraphRunContext[AgentState]) -> "ExtractionNode":
        print(f"--> Searching for {len(ctx.state.tasks)} topics...")
        for task in ctx.state.tasks:
            # Mocking the search output
            task.raw_result = f"Data for {task.query}: Python 3.14 features improved JIT. It is highly optimized."
            task.status = "completed"
        return ExtractionNode()

class ExtractionNode(BaseNode[AgentState]):
    async def run(self, ctx: GraphRunContext[AgentState]) -> "ReportNode":
        print("--> Extracting claims...")
        for task in ctx.state.tasks:
            try:
                res = await extractor_agent.run(task.raw_result)
                ctx.state.extracted_claims.extend(res.output)
            except Exception as e:
                print(f"Fallback triggered for Extractor due to: {e}")
                raw = await fallback_agent.run(f"Extract claims from this text as a JSON list of objects. Each object must have 'statement' (string), 'source_url' (string, use 'unknown' if not found), 'confidence_score' (float 0-1), and 'is_verified' (bool). No xml or markdown tags: {task.raw_result}")
                clean = sanitize_llama_json(raw.output)
                claims = TypeAdapter(List[Claim]).validate_json(clean)
                ctx.state.extracted_claims.extend(claims)
        return ReportNode()

class ReportNode(BaseNode[AgentState]):
    async def run(self, ctx: GraphRunContext[AgentState]) -> End:
        print("--> Writing report...")
        claims_text = "\n".join([f"- {c.statement} ({c.source_url})" for c in ctx.state.extracted_claims])
        ctx.state.final_report = f"REPORT FOR: {ctx.state.original_query}\n\n{claims_text}"
        return End(ctx.state)

# 6. MAIN EXECUTION
async def main():
    topic = input("Enter research topic: ")
    state = AgentState(original_query=topic)
    
    research_graph = Graph(
        nodes=[PlannerNode, SearchNode, ExtractionNode, ReportNode]
    )
    
    # Running the graph
    result = await research_graph.run(PlannerNode(), state=state)
    
    print("\n" + "="*30)
    # The End(ctx.state) returns the state object as the result
    print(result.output.final_report)

if __name__ == "__main__":
    asyncio.run(main())