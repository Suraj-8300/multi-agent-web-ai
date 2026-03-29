"""LLM service — wraps Groq (llama-3.3-70b-versatile) with retry and JSON enforcement.

Python 3.14 compatible: uses asyncio.get_running_loop() instead of deprecated get_event_loop().
"""
import os
import json
import asyncio
import re
import random
from groq import Groq

_client: Groq | None = None
groq_lock = asyncio.Semaphore(5)


def get_client() -> Groq:
    global _client
    if _client is None:
        api_key = os.environ.get("GROQ_API_KEY", "")
        if not api_key:
            raise RuntimeError("GROQ_API_KEY environment variable is not set")
        _client = Groq(api_key=api_key)
    return _client


def _clean_json(text: str) -> str:
    """Strip markdown fences and XML tags from LLM output."""
    text = re.sub(r"<function.*?>", "", text, flags=re.DOTALL)
    text = re.sub(r"</function>", "", text)
    text = re.sub(r"```json\s*", "", text)
    text = re.sub(r"```\s*", "", text)
    match = re.search(r"([{\[].*[}\]])", text, re.DOTALL)
    return match.group(1).strip() if match else text.strip()


async def call_llm(prompt: str, system: str = "", temperature: float = 0.1, model: str = "llama-3.1-8b-instant") -> str:
    """Async LLM call — runs Groq (sync SDK) in executor to avoid blocking the event loop.

    Uses asyncio.get_running_loop() — Python 3.10+ / 3.14 compatible.
    Retries up to 3 times with exponential back-off and jitter.
    """
    client = get_client()

    def _call():
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})
        resp = client.chat.completions.create(
            model=model,
            messages=messages,
            temperature=temperature,
            max_tokens=2048,  # Trimming token fat slightly
        )
        return resp.choices[0].message.content or ""

    loop = asyncio.get_running_loop()
    for attempt in range(3):
        try:
            async with groq_lock:
                text = await loop.run_in_executor(None, _call)
                await asyncio.sleep(0.1)  # tiny stagger to prevent burst threshold spikes
                return text
        except Exception as e:
            err = str(e)
            if "rate_limit" in err.lower() or "429" in err:
                wait = min(120, 5 * (2 ** attempt)) + random.uniform(1, 5)
                print(f"[LLM] Rate limited. Waiting {wait:.1f}s before retry {attempt + 1}...")
                await asyncio.sleep(wait)
            else:
                print(f"[LLM] Error on attempt {attempt + 1}: {e}")
                if attempt < 2:
                    await asyncio.sleep(2 * (attempt + 1))
    return ""


async def call_llm_json(prompt: str, system: str = "", temperature: float = 0.1, model: str = "llama-3.1-8b-instant") -> dict | list:
    """LLM call that always returns parsed JSON (dict or list)."""
    system_json = (
        (system or "")
        + "\nReturn ONLY raw valid JSON. No markdown fences, no preamble, no explanations."
    )
    raw = await call_llm(prompt, system=system_json, temperature=temperature, model=model)
    cleaned = _clean_json(raw)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        # Second attempt — ask the model to just give the JSON
        raw2 = await call_llm(
            f"The following output needs to be valid JSON only. Extract and return ONLY the JSON:\n{raw}",
            system="Return only raw valid JSON. Nothing else.",
            model=model
        )
        cleaned2 = _clean_json(raw2)
        try:
            return json.loads(cleaned2)
        except Exception:
            return {}
