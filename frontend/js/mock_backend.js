// mock_backend.js - Simulates SSE streaming and Agent pipeline using the Gemini API

class MockBackend {
    constructor(uiController) {
        this.UI = uiController;
        this.apiKey = CONFIG.GEMINI_API_KEY;
        this.model = CONFIG.GEMINI_MODEL;
    }

    async runPipeline(query, mode, type) {
        this.UI.clearDashboards();
        this.UI.startLoading();

        // Simulate Planner Agent
        this.UI.appendTrace("Planner Agent: Decomposing query into sub-tasks...");
        await this.sleep(1200);
        this.UI.updateTraceActiveToDone();

        let agentCount = 3;
        if(mode === 'fact_check') agentCount = 4;
        if(mode === 'research') agentCount = 8;
        if(mode === 'deep_dive') agentCount = 15;

        // Simulate Parallel Target dispatch
        this.UI.appendTrace(`Planner Agent: Dispatched ${agentCount} parallel search intents based on ${mode} mode.`);
        await this.sleep(800);
        this.UI.updateTraceActiveToDone();

        // Simulate Search Agent Activity
        this.UI.appendTrace("Search Agents: Fetching real-time content across domains...");
        
        // --- GEMINI API CALL (Mocking the whole pipeline output) ---
        // Instead of running 8 searches, we ask Gemini to hallucinate the resulting JSON matching our schema
        const systemPrompt = `
You are the WebIntel Verification Backend. Your job is to output ONLY VALID RAW JSON. Do not use Markdown block syntax (like \`\`\`json). Just return the JSON object directly.
The user submitted:
- Query: "${query}"
- Mode: "${mode}"
- Type: "${type}"

Generate a structured report representing the final aggregated truth.
Schema:
{
  "query": "${query}",
  "query_type": "${type}",
  "mode": "${mode}",
  "verified_claims": [
    {
      "claim": "string", "confidence": number(0-100), 
      "supporting_sources": ["url(string)"], 
      "conflicting_sources": ["url(string)"] or null, 
      "conflict_detail": "string or null", 
      "resolution_method": "string or null", 
      "status": "verified" | "conflict" | "unresolved"
    }
  ],
  "sources": [
    {
      "url": "string", "domain": "string", "trust_tier": "high"|"medium"|"low", 
      "trust_score": number(0-100), "agreements_count": number, "conflicts_count": number, "discarded": boolean
    }
  ],
  "overall_confidence": number(0-100),
  "total_sources_visited": number,
  "conflicts_detected": number,
  "conflicts_resolved": number
}

Rules:
1. Provide highly realistic URLs corresponding to the trust tier (e.g. .gov.in, nseindia, reuters for high).
2. For "research" or "deep_dive", include at least 1 or 2 minor conflicts handled logically.
3. Keep confidence scores dynamic.
4. ONLY return the valid JSON map.
`;

        try {
            const apiResp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: systemPrompt }] }]
                })
            });

            if (!apiResp.ok) {
                console.error("API error", await apiResp.text());
                throw new Error("Failed connecting to Gemini API");
            }

            const apiData = await apiResp.json();
            const rawText = apiData.candidates[0].content.parts[0].text.trim();
            
            // Cleanup any accidental markdown fences
            let jsonText = rawText;
            if (jsonText.startsWith('```json')) {
                jsonText = jsonText.substring(7);
                if (jsonText.endsWith('```')) {
                    jsonText = jsonText.substring(0, jsonText.length-3);
                }
            } else if (jsonText.startsWith('```')) {
                jsonText = jsonText.substring(3);
                if (jsonText.endsWith('```')) {
                    jsonText = jsonText.substring(0, jsonText.length-3);
                }
            }
            jsonText = jsonText.trim();
            
            this.UI.updateTraceActiveToDone();
            this.UI.appendTrace("Extraction Agent: Parsing factual claims from raw content...");
            await this.sleep(1500);

            const report = JSON.parse(jsonText);

            // Simulate streaming the results to UI gradually
            this.UI.updateTraceActiveToDone();
            this.UI.appendTrace("Verification Agent: Cross-referencing entities and resolving conflicts...");
            
            await this.sleep(1000);

            // Stream sources first
            for(let i=0; i<report.sources.length; i++) {
                this.UI.renderSource(report.sources[i]);
                await this.sleep(200); // 200ms per source arrival
            }

            // Stream claims
            this.UI.updateTraceActiveToDone();
            this.UI.appendTrace("Stream: Flushing verified claims to UI...");
            for(let i=0; i<report.verified_claims.length; i++) {
                this.UI.renderClaim(report.verified_claims[i]);
                await this.sleep(600); // 600ms per claim arrival to look deliberate
            }

            this.UI.updateTraceActiveToDone();
            this.UI.appendTrace("Report Agent: Assembly complete.");
            
            // Render Final Report Stats
            this.UI.renderFinalReport(report);
            this.UI.stopLoading();

        } catch (error) {
            console.error(error);
            this.UI.updateTraceActiveToDone();
            this.UI.appendTrace(`⚠️ Pipeline Error: ${error.message}`);
            this.UI.stopLoading();
        }
    }

    sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
}

window.MockBackend = MockBackend;
