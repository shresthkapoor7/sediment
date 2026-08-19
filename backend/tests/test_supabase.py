from __future__ import annotations

import asyncio
import unittest
from unittest.mock import patch

import aiohttp

from app.db.supabase import SupabaseAPIError, SupabaseClient, _supabase_response_error


class SupabaseErrorTests(unittest.TestCase):
    def test_database_error_preserves_http_status_and_sqlstate(self) -> None:
        error = _supabase_response_error(
            "Supabase request failed",
            400,
            '{"code":"22023","message":"Special note storage quota exceeded"}',
        )

        self.assertEqual(error.status_code, 400)
        self.assertEqual(error.sqlstate, "22023")
        self.assertIn("Special note storage quota exceeded", str(error))

    def test_non_json_error_has_no_sqlstate(self) -> None:
        error = _supabase_response_error("Supabase request failed", 502, "upstream unavailable")

        self.assertEqual(error.status_code, 502)
        self.assertIsNone(error.sqlstate)


class SupabaseStorageTransportTests(unittest.IsolatedAsyncioTestCase):
    async def test_storage_request_normalizes_transport_and_timeout_failures(self) -> None:
        client = object.__new__(SupabaseClient)
        client.base_url = "https://supabase.example"
        client.headers = {}

        for failure in (aiohttp.ClientConnectionError("offline"), asyncio.TimeoutError()):
            with self.subTest(failure=type(failure).__name__):
                class FailingSession:
                    def __init__(self, **_kwargs):
                        pass

                    async def __aenter__(self):
                        return self

                    async def __aexit__(self, *_args):
                        return False

                    def request(self, *_args, **_kwargs):
                        raise failure

                with patch("app.db.supabase.aiohttp.ClientSession", FailingSession):
                    with self.assertRaises(SupabaseAPIError) as raised:
                        await client._storage_request("POST", "/storage/v1/object/special-notes/test")

                self.assertIs(raised.exception.__cause__, failure)


if __name__ == "__main__":
    unittest.main()
