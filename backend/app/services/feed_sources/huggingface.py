from __future__ import annotations

from .base import Paper
from .openalex import HUGGINGFACE_SOURCE_ID, OpenAlexSource


class HuggingFaceSource(OpenAlexSource):
    """Hugging Face repository papers retrieved exclusively through OpenAlex."""
    name = 'huggingface'
    source_filter = 'primary_location.source.id:' + HUGGINGFACE_SOURCE_ID + ',primary_location.source.type:repository'
    # Restart exhausted native-API streams and avoid their cached pages.
    cache_namespace = 'huggingface-openalex-v1'
    cursor_version = cache_namespace

    @staticmethod
    def parse(raw: dict) -> Paper | None:
        source = (raw.get('primary_location') or {}).get('source') or {}
        if (source.get('id') or '').rsplit('/', 1)[-1] != HUGGINGFACE_SOURCE_ID:
            return None
        return OpenAlexSource.parse(raw)
