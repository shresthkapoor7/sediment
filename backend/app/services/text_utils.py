from __future__ import annotations

import re

NON_ALNUM = re.compile(r"[^a-z0-9]+")
STOPWORDS = {
    "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "how",
    "in", "into", "is", "it", "of", "on", "or", "relate", "related", "the",
    "this", "through", "to", "toward", "towards", "using", "via", "with",
    "based",
}


def normalize_text(text: str) -> str:
    return NON_ALNUM.sub(" ", text.lower()).strip()


def meaningful_token_list(text: str, *, min_len: int = 3) -> list[str]:
    return [
        token
        for token in normalize_text(text).split()
        if len(token) >= min_len and token not in STOPWORDS
    ]


def meaningful_tokens(text: str, *, min_len: int = 3) -> set[str]:
    return set(meaningful_token_list(text, min_len=min_len))
