import unittest
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

from app.db.feeds import FeedRepository


class FeedCacheTimestampTests(unittest.IsolatedAsyncioTestCase):
    async def test_postgres_timestamp_precision_and_expiration(self):
        now = datetime(2026, 9, 28, 1, 25, 20, 154430, tzinfo=timezone.utc)
        timestamps = [
            ('2026-09-28T01:25:20.15443+00:00', False),  # Reported failure; expires exactly now.
            ('2026-09-28T01:25:20.15444+00:00', True),
            ('2026-09-28T01:25:20.1+00:00', False),
            ('2026-09-28T01:25:20.16+00:00', True),
            ('2026-09-28T01:25:20.154+00:00', False),
            ('2026-09-28T01:25:20.1545+00:00', True),
            ('2026-09-28T01:25:20.154431+00:00', True),
            ('2026-09-28T01:25:20+00:00', False),
            ('2026-09-28T01:25:21Z', True),
            ('2026-09-27T21:25:20.15444-04:00', True),
        ]
        repo = FeedRepository()
        for timestamp, valid in timestamps:
            with self.subTest(timestamp=timestamp):
                repo.db._request = AsyncMock(return_value={
                    'expires_at': timestamp, 'paper_ids': [], 'next_cursor': 'next',
                })
                with patch('app.db.feeds.datetime', wraps=datetime) as clock:
                    clock.now.return_value = now
                    result = await repo.cached('test-key')
                if valid:
                    self.assertEqual(result.papers, [])
                    self.assertEqual(result.next_cursor, 'next')
                else:
                    self.assertIsNone(result)
                repo.db._request.assert_awaited_once()
