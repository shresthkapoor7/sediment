from __future__ import annotations

from dataclasses import dataclass

from ..db.supabase import SupabaseClient
from .llm import LLMClient

RECENT_MESSAGE_LIMIT = 24
SUMMARY_RETAIN_MESSAGES = 12
SUMMARY_BATCH_MIN_MESSAGES = 10
SUMMARY_BATCH_MAX_MESSAGES = 40


@dataclass
class ChatContext:
    session: dict
    messages: list[dict]

    @property
    def history(self) -> list[dict]:
        summarized_through = int(self.session.get("summary_through_sequence") or 0)
        return [
            {"role": message["role"], "content": message["content"]}
            for message in self.messages
            if message.get("role") in {"user", "assistant"}
            and int(message.get("sequence_number") or 0) > summarized_through
        ]

    @property
    def summary(self) -> str | None:
        value = self.session.get("summary")
        return value if isinstance(value, str) and value.strip() else None


class ChatMemoryService:
    def __init__(self, db: SupabaseClient | None = None) -> None:
        self.db = db or SupabaseClient()

    async def open(
        self,
        graph_id: str,
        user_id: str,
        scope: str,
        paper_openalex_id: str | None = None,
        *,
        message_limit: int = RECENT_MESSAGE_LIMIT,
    ) -> ChatContext:
        session = await self.db.get_or_create_chat_session(
            graph_id,
            user_id,
            scope,
            paper_openalex_id,
        )
        messages = await self.db.list_chat_messages(session["id"], user_id, limit=message_limit)
        return ChatContext(session=session, messages=messages)

    async def append(
        self,
        context: ChatContext,
        user_id: str,
        role: str,
        content: str,
        *,
        tool_uses: list[dict] | None = None,
        citations: list[dict] | None = None,
    ) -> dict:
        return await self.db.append_chat_message(
            context.session["id"],
            user_id,
            role,
            content,
            tool_uses=tool_uses,
            citations=citations,
        )

    async def maybe_summarize(
        self,
        context: ChatContext,
        user_id: str,
        latest_sequence: int,
        llm: LLMClient,
        ip: str,
    ) -> None:
        summarized_through = int(context.session.get("summary_through_sequence") or 0)
        eligible_through = latest_sequence - SUMMARY_RETAIN_MESSAGES
        if eligible_through - summarized_through < SUMMARY_BATCH_MIN_MESSAGES:
            return

        messages = await self.db.list_chat_messages_range(
            context.session["id"],
            user_id,
            after_sequence=summarized_through,
            through_sequence=eligible_through,
            limit=SUMMARY_BATCH_MAX_MESSAGES,
        )
        if len(messages) < SUMMARY_BATCH_MIN_MESSAGES:
            return
        through_sequence = int(messages[-1]["sequence_number"])
        try:
            summary = await llm.summarize_conversation(context.summary, messages, ip=ip)
        except Exception:
            return
        await self.db.update_chat_session_summary(
            context.session["id"],
            user_id,
            summary,
            through_sequence,
        )


def serialize_chat_context(context: ChatContext) -> dict:
    session = context.session
    return {
        "sessionId": session["id"],
        "scope": session["scope"],
        "paperOpenalexId": session.get("paper_openalex_id"),
        "summary": session.get("summary"),
        "messages": [
            {
                "id": message["id"],
                "role": message["role"],
                "content": message["content"],
                "toolUses": message.get("tool_uses") or [],
                "citations": message.get("citations") or [],
                "sequenceNumber": message["sequence_number"],
                "createdAt": message["created_at"],
            }
            for message in context.messages
        ],
    }
