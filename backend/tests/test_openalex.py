from __future__ import annotations

import unittest
from unittest.mock import AsyncMock, patch

from app.services.openalex import OpenAlexClient, _filter_search_value


class OpenAlexSearchTests(unittest.IsolatedAsyncioTestCase):
    def test_quotes_literal_filter_values(self) -> None:
        self.assertEqual(_filter_search_value("attention, rnn"), '"attention, rnn"')
        self.assertEqual(_filter_search_value('say "hello"'), '"say \\"hello\\""')

    async def test_search_quotes_comma_containing_concept_in_both_filters(self) -> None:
        client = OpenAlexClient()
        client._session = object()  # type: ignore[assignment]
        with patch("app.services.openalex._get", AsyncMock(side_effect=[{"results": []}, {"results": []}])) as get:
            await client.search_papers("Attention is all you need, rnn and transformers", limit=5)

        filters = {call.args[2]["filter"] for call in get.await_args_list}
        self.assertEqual(filters, {
            'display_name.search:"Attention is all you need, rnn and transformers"',
            'title_and_abstract.search:"Attention is all you need, rnn and transformers"',
        })

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

