import unittest

from app.routers.papers import resolve_identifier, summarize_abstract, to_graph_paper


class ResolveIdentifierTests(unittest.TestCase):
    def test_free_text_is_not_an_identifier(self) -> None:
        self.assertIsNone(resolve_identifier("chain of thought prompting"))

    def test_openalex_id_and_url(self) -> None:
        self.assertEqual(resolve_identifier("w2741809807"), "W2741809807")
        self.assertEqual(resolve_identifier("https://openalex.org/W2741809807"), "W2741809807")

    def test_arxiv_link_maps_to_its_doi(self) -> None:
        self.assertEqual(
            resolve_identifier("https://arxiv.org/abs/1706.03762v5"),
            "doi:10.48550/arXiv.1706.03762",
        )
        self.assertEqual(resolve_identifier("arXiv:2201.11903"), "doi:10.48550/arXiv.2201.11903")

    def test_doi_bare_and_as_url(self) -> None:
        self.assertEqual(resolve_identifier("10.1038/nature14539"), "doi:10.1038/nature14539")
        self.assertEqual(
            resolve_identifier("https://doi.org/10.1038/nature14539?utm=x"),
            "doi:10.1038/nature14539",
        )


class SummaryTests(unittest.TestCase):
    def test_short_abstract_is_kept(self) -> None:
        self.assertEqual(summarize_abstract("  A short   abstract. "), "A short abstract.")

    def test_long_abstract_ends_on_a_sentence(self) -> None:
        text = ("We study a thing in considerable depth across many settings and report results. " * 6).strip()
        summary = summarize_abstract(text)
        self.assertLessEqual(len(summary), 221)
        self.assertTrue(summary.endswith("."))

    def test_graph_paper_carries_reference_count(self) -> None:
        paper = to_graph_paper({"openalexId": "W1", "title": "T", "detail": "Abstract.", "referencedWorksCount": 7})
        self.assertEqual(paper.referencesCount, 7)
        self.assertEqual(paper.summary, "Abstract.")


if __name__ == "__main__":
    unittest.main()
