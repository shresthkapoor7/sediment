from __future__ import annotations

import unittest
from unittest.mock import AsyncMock

from app.services.chat_memory import ChatContext, ChatMemoryService, serialize_chat_context


class ChatMemoryTests(unittest.IsolatedAsyncioTestCase):
    async def test_open_restores_ordered_messages(self) -> None:
        db = AsyncMock()
        db.get_or_create_chat_session.return_value = {
            "id": "session-1",
            "scope": "paper",
            "paper_openalex_id": "W1",
            "summary": "Earlier context",
        }
        db.list_chat_messages.return_value = [
            {"role": "user", "content": "Question", "sequence_number": 1},
            {"role": "assistant", "content": "Answer", "sequence_number": 2},
        ]

        context = await ChatMemoryService(db).open("graph-1", "user-1", "paper", "W1")

        self.assertEqual(context.summary, "Earlier context")
        self.assertEqual(context.history[0], {"role": "user", "content": "Question"})
        db.list_chat_messages.assert_awaited_once_with("session-1", "user-1", limit=24)

    async def test_periodic_summary_keeps_recent_turns_verbatim(self) -> None:
        db = AsyncMock()
        db.list_chat_messages_range.return_value = [
            {"role": "user" if index % 2 else "assistant", "content": f"message {index}", "sequence_number": index}
            for index in range(1, 11)
        ]
        llm = AsyncMock()
        llm.summarize_conversation.return_value = "Updated summary"
        context = ChatContext(
            session={"id": "session-1", "summary": "Old", "summary_through_sequence": 0},
            messages=[],
        )

        await ChatMemoryService(db).maybe_summarize(
            context,
            "user-1",
            latest_sequence=22,
            llm=llm,
            ip="127.0.0.1",
        )

        db.list_chat_messages_range.assert_awaited_once_with(
            "session-1",
            "user-1",
            after_sequence=0,
            through_sequence=10,
            limit=40,
        )
        db.update_chat_session_summary.assert_awaited_once_with(
            "session-1", "user-1", "Updated summary", 10,
        )

    def test_serializes_tool_records_for_ui_restoration(self) -> None:
        context = ChatContext(
            session={"id": "session-1", "scope": "graph", "summary": None},
            messages=[{
                "id": "message-1",
                "role": "assistant",
                "content": "Answer",
                "tool_uses": [{"name": "global_response"}],
                "citations": [],
                "sequence_number": 3,
                "created_at": "2026-06-22T00:00:00Z",
            }],
        )
        serialized = serialize_chat_context(context)
        self.assertEqual(serialized["messages"][0]["toolUses"][0]["name"], "global_response")
        self.assertEqual(serialized["messages"][0]["sequenceNumber"], 3)


if __name__ == "__main__":
    unittest.main()
