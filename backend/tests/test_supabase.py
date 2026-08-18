from __future__ import annotations

import unittest

from app.db.supabase import _supabase_response_error


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


if __name__ == "__main__":
    unittest.main()
