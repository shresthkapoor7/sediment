from __future__ import annotations

import unittest
from unittest.mock import patch

from app.main import app, settings


class RequestSizeMiddlewareTests(unittest.IsolatedAsyncioTestCase):
    async def _send_request(self, chunks: list[bytes], headers: list[tuple[bytes, bytes]] = []) -> tuple[list[dict], int]:
        messages: list[dict] = []
        receive_calls = 0

        async def receive() -> dict:
            nonlocal receive_calls
            receive_calls += 1
            if chunks:
                body = chunks.pop(0)
                return {
                    "type": "http.request",
                    "body": body,
                    "more_body": bool(chunks),
                }
            return {"type": "http.disconnect"}

        async def send(message: dict) -> None:
            messages.append(message)

        await app(
            {
                "type": "http",
                "asgi": {"version": "3.0", "spec_version": "2.3"},
                "http_version": "1.1",
                "method": "POST",
                "scheme": "http",
                "path": "/api/graphs/22222222-2222-2222-2222-222222222222/special-notes",
                "raw_path": b"/api/graphs/22222222-2222-2222-2222-222222222222/special-notes",
                "query_string": b"",
                "headers": headers,
                "client": ("127.0.0.1", 50100),
                "server": ("testserver", 80),
            },
            receive,
            send,
        )
        return messages, receive_calls

    async def test_unbounded_special_note_stream_stops_once_limit_is_exceeded(self) -> None:
        with patch.object(settings, "max_special_note_upload_request_bytes", 8):
            messages, receive_calls = await self._send_request([b"1234", b"5678", b"9012", b"unused"])

        self.assertEqual(receive_calls, 3)
        self.assertEqual(messages[0]["type"], "http.response.start")
        self.assertEqual(messages[0]["status"], 413)

    async def test_declared_oversized_special_note_request_is_rejected_before_body_read(self) -> None:
        with patch.object(settings, "max_special_note_upload_request_bytes", 8):
            messages, receive_calls = await self._send_request(
                [b"body should not be read"],
                headers=[(b"content-length", b"9")],
            )

        self.assertEqual(receive_calls, 0)
        self.assertEqual(messages[0]["type"], "http.response.start")
        self.assertEqual(messages[0]["status"], 413)


if __name__ == "__main__":
    unittest.main()
