from app.actor import Actor
import unittest
from unittest.mock import AsyncMock, patch

from app.routers import feed_chat
from app.routers.feed_chat import FeedChatPaper, FeedChatRequest


def paper(paper_id: str, title: str) -> FeedChatPaper:
    return FeedChatPaper(id=paper_id, title=title, abstract="An abstract.")


class FeedChatToolTests(unittest.IsolatedAsyncioTestCase):
    async def run_with(self, question: str, script):
        events: list[tuple[str, dict]] = []

        async def emit(kind, payload):
            events.append((kind, payload))

        async def fake_agent(_client, prompt, *, tool_runner, **_kwargs):
            results = [await tool_runner(name, tool_input) for name, tool_input in script]
            return {"text": "ok", "results": results, "prompt": prompt}

        req = FeedChatRequest(
            question=question,
            interests="graph neural networks",
            feedPapers=[paper("openalex:W1", "Feed paper")],
            markedPapers=[paper("openalex:W2", "Marked paper")],
        )
        with patch.object(feed_chat, "run_feed_agent", fake_agent), \
             patch.object(feed_chat.limiter, "claim_request", AsyncMock()), \
             patch.object(feed_chat.limiter, "get_summary", AsyncMock(return_value={"remaining": 0.2})):
            await feed_chat._run(req, Actor(kind="browser", id="browser-1", ip="1.2.3.4"), emit)
        return events

    async def test_marks_known_papers_and_offers_a_workspace(self) -> None:
        events = await self.run_with("mark the feed paper", [
            ("mark_papers", {"paperIds": ["openalex:W1", "openalex:W2", "nope"]}),
            ("offer_workspace", {}),
        ])
        kinds = [kind for kind, _ in events]
        self.assertIn("workspace_offer", kinds)
        marked = next(payload for kind, payload in events if kind == "mark_papers")
        self.assertEqual([p["id"] for p in marked["papers"]], ["openalex:W1"])

    async def test_interests_change_needs_the_researchers_words(self) -> None:
        events = await self.run_with("what is this paper about?", [
            ("update_interests", {"interests": "robotics", "researcherRequest": "switch to robotics"}),
        ])
        self.assertNotIn("interests_change", [kind for kind, _ in events])
        events = await self.run_with("please switch to robotics", [
            ("update_interests", {"interests": "robotics", "researcherRequest": "switch to robotics"}),
        ])
        self.assertIn(("interests_change", {"interests": "robotics"}), events)


if __name__ == "__main__":
    unittest.main()
