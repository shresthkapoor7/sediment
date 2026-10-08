from __future__ import annotations

import unittest
from unittest.mock import AsyncMock, patch

from app.services.openalex import OpenAlexClient, _filter_search_value


class OpenAlexSearchTests(unittest.IsolatedAsyncioTestCase):
    def test_quotes_literal_filter_values(self) -> None:
        self.assertEqual(_filter_search_value("attention, rnn"), '"attention, rnn"')
        self.assertEqual(_filter_search_value('say "hello"'), '"say \\"hello\\""')

    async def test_search_preserves_queries_without_forcing_phrase_matching(self) -> None:
        client = OpenAlexClient()
        client._session = object()  # type: ignore[assignment]
        for query in [
            "Psychology of well-being - life satisfaction and happiness research",
            "Chain-of-thought prompting (language models)",
            "Attention is all you need, rnn and transformers",
            '\"chain of thought\" AND reasoning',
        ]:
            with self.subTest(query=query):
                with patch("app.services.openalex._get", AsyncMock(return_value={"results": []})) as get:
                    await client.search_papers(query, limit=5)
                params = [call.args[2] for call in get.await_args_list]
                self.assertEqual(params[0]["search.title"], query)
                self.assertEqual(params[1]["search.title_abstract_keywords"], query)
                for request in params:
                    self.assertNotIn("filter", request)
                    self.assertNotIn("sort", request)

    async def test_broad_results_survive_empty_title_search(self) -> None:
        client = OpenAlexClient()
        client._session = object()  # type: ignore[assignment]
        paper = {"openalexId": "W1", "title": "Chain-of-thought prompting"}
        with patch("app.services.openalex._get", AsyncMock(side_effect=[
            {"results": []}, {"results": [paper]},
        ])), patch.object(client, "_normalize_work", side_effect=lambda work: work):
            self.assertEqual(await client.search_papers("chain of thought language models"), [paper])

    async def test_related_paper_fallback_quotes_title_before_adding_year_filter(self) -> None:
        client = OpenAlexClient()
        client._session = object()  # type: ignore[assignment]
        with patch("app.services.openalex._get", AsyncMock(return_value={"results": []})) as get:
            await client.fetch_related_earlier_papers({
                "openalexId": "W1",
                "title": "Attention, RNNs, and Transformers",
                "year": 2020,
                "primaryTopic": None,
            })

        self.assertEqual(
            get.await_args.args[2]["filter"],
            'title_and_abstract.search:"Attention, RNNs, and Transformers",publication_year:<2020',
        )

