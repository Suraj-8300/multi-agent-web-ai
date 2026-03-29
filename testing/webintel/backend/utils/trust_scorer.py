"""Trust scoring for source domains."""

HIGH_TRUST_DOMAINS = {
    # Government
    "gov.in", "nic.in", "rbi.org.in", "sebi.gov.in", "mca.gov.in",
    "pib.gov.in", "data.gov.in", "india.gov.in", "uidai.gov.in",
    "gov.uk", "gov.us", "usa.gov", "cdc.gov", "nih.gov",
    # Financial / Stock Exchanges
    "nseindia.com", "bseindia.com", "bloomberg.com", "wsj.com",
    "ft.com", "reuters.com", "apnews.com",
    # Global Orgs
    "who.int", "un.org", "worldbank.org", "imf.org", "oecd.org",
    # Academic
    "nature.com", "science.org", "pubmed.ncbi.nlm.nih.gov", "arxiv.org",
}

MEDIUM_TRUST_DOMAINS = {
    # News India
    "economictimes.indiatimes.com", "livemint.com", "thehindu.com",
    "ndtv.com", "hindustantimes.com", "business-standard.com",
    "timesofindia.indiatimes.com", "indianexpress.com", "moneycontrol.com",
    # News Global
    "bbc.com", "bbc.co.uk", "theguardian.com", "nytimes.com",
    "washingtonpost.com", "cnn.com", "nbcnews.com", "abcnews.go.com",
    # Tech
    "techcrunch.com", "wired.com", "theverge.com", "arstechnica.com",
    "venturebeat.com", "zdnet.com", "engadget.com",
    # Business
    "forbes.com", "fortune.com", "businessinsider.com", "entrepreneur.com",
    # Academic light
    "wikipedia.org", "britannica.com",
}

LOW_TRUST_DOMAINS = {
    "reddit.com", "quora.com", "medium.com", "substack.com",
    "twitter.com", "x.com", "facebook.com", "linkedin.com",
    "tumblr.com", "wordpress.com", "blogspot.com",
}

DISCARD_BELOW = 25


def get_domain(url: str) -> str:
    try:
        from urllib.parse import urlparse
        parsed = urlparse(url)
        domain = parsed.netloc.lower()
        if domain.startswith("www."):
            domain = domain[4:]
        return domain
    except Exception:
        return url


def score_domain(url: str) -> tuple[str, int]:
    """Returns (trust_tier, trust_score) for a given URL."""
    domain = get_domain(url)

    # Check high trust
    for trusted in HIGH_TRUST_DOMAINS:
        if domain == trusted or domain.endswith("." + trusted):
            return "high", 90

    # Check medium trust
    for medium in MEDIUM_TRUST_DOMAINS:
        if domain == medium or domain.endswith("." + medium):
            return "medium", 62

    # Check low trust
    for low in LOW_TRUST_DOMAINS:
        if domain == low or domain.endswith("." + low):
            return "low", 30

    # Unknown default
    return "unknown", 45


def should_discard(trust_score: int) -> bool:
    return trust_score < DISCARD_BELOW
