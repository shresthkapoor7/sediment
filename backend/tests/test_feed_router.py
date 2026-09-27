import unittest
from unittest.mock import AsyncMock, patch

import httpx
from fastapi import FastAPI

from app.routers.feeds import router
from app.db.supabase import SupabaseConfigError
from app.services.feeds import FeedService
from tests.test_feeds import Repo, Source

USER = '12345678-1234-4234-8234-123456789012'


class FeedRouterTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        app = FastAPI()
        app.include_router(router, prefix='/api')
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test')
        self.source = Source()
        self.service = FeedService(Repo(), [self.source])
        self.factory = patch('app.routers.feeds.FeedService', return_value=self.service)
        self.limiter = patch('app.routers.feeds.limiter.claim_request', AsyncMock())
        self.factory.start()
        self.limiter.start()

    async def asyncTearDown(self):
        self.factory.stop()
        self.limiter.stop()
        await self.client.aclose()

    async def test_empty_create_more_and_restore_over_http(self):
        empty = await self.client.get('/api/feeds', params={'userId': USER})
        self.assertEqual(empty.status_code, 200)
        self.assertEqual(empty.headers['cache-control'], 'no-store')
        self.assertEqual(self.source.calls, 0)
        created = await self.client.post('/api/feeds', json={'userId': USER, 'action': 'interests', 'interests': 'robot learning'})
        self.assertEqual(created.status_code, 200)
        first = created.json()
        more = await self.client.post('/api/feeds', json={'userId': USER, 'action': 'more', 'cursor': first['cursor']})
        self.assertEqual(more.status_code, 200)
        self.assertEqual(len(more.json()['papers']), 12)
        self.assertFalse({p['id'] for p in first['papers']} & {p['id'] for p in more.json()['papers']})
        restored = await self.client.get('/api/feeds', params={'userId': USER})
        self.assertEqual(restored.json()['interests'], 'robot learning')
        self.assertEqual(restored.json()['papers'], first['papers'])

    async def test_invalid_actions_and_inputs_never_call_provider(self):
        for body in [
            {'userId': 'invalid', 'action': 'refresh'},
            {'userId': USER, 'action': 'interests', 'interests': ' '},
            {'userId': USER, 'action': 'refresh', 'interests': 'robotics'},
            {'userId': USER, 'action': 'more'},
        ]:
            response = await self.client.post('/api/feeds', json=body)
            self.assertIn(response.status_code, [400, 422])
        self.assertEqual(self.source.calls, 0)

    async def test_missing_storage_configuration_returns_recoverable_error(self):
        with patch('app.routers.feeds.limiter.claim_request', AsyncMock(side_effect=SupabaseConfigError('missing config'))):
            response = await self.client.post('/api/feeds', json={'userId': USER, 'action': 'refresh'})
        self.assertEqual(response.status_code, 503)
        self.assertNotIn('missing config', response.text)

    async def test_source_selection_and_cursor_scope_over_http(self):
        await self.client.post('/api/feeds', json={'userId': USER, 'action': 'interests', 'interests': 'robot learning'})
        selected = await self.client.post('/api/feeds', json={'userId': USER, 'action': 'source', 'source': 'arxiv'})
        self.assertEqual(selected.status_code, 200)
        self.assertEqual(selected.json()['source'], 'arxiv')
        self.assertEqual(len(selected.json()['papers']), 12)
        cursor = selected.json()['cursor']
        wrong = await self.client.post('/api/feeds', json={'userId': USER, 'action': 'more', 'source': 'openalex', 'cursor': cursor})
        self.assertEqual(wrong.status_code, 409)
        more = await self.client.post('/api/feeds', json={'userId': USER, 'action': 'more', 'source': 'arxiv', 'cursor': cursor})
        self.assertEqual(more.status_code, 200)
        self.assertFalse({p['id'] for p in selected.json()['papers']} & {p['id'] for p in more.json()['papers']})
        invalid = await self.client.post('/api/feeds', json={'userId': USER, 'action': 'source', 'source': 'unknown'})
        self.assertEqual(invalid.status_code, 422)
