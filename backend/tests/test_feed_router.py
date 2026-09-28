import unittest
from unittest.mock import AsyncMock, patch

import httpx
from fastapi import FastAPI

from app.routers.feeds import router
from app.db.supabase import SupabaseConfigError
from app.services.feeds import FeedService
from app.services.feed_identity import issue_feed_credential, resolve_feed_actor
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
        session = await self.client.post('/api/feed-session')
        self.assertEqual(session.headers['cache-control'], 'no-store')
        self.token = session.json()['token']
        self.client.headers['Authorization'] = 'Bearer ' + self.token

    async def asyncTearDown(self):
        self.factory.stop()
        self.limiter.stop()
        await self.client.aclose()

    async def test_empty_create_more_and_restore_over_http(self):
        empty = await self.client.get('/api/feeds', params={})
        self.assertEqual(empty.status_code, 200)
        self.assertEqual(empty.headers['cache-control'], 'no-store')
        self.assertEqual(self.source.calls, 0)
        created = await self.client.post('/api/feeds', json={'action': 'interests', 'interests': 'robot learning'})
        self.assertEqual(created.status_code, 200)
        first = created.json()
        more = await self.client.post('/api/feeds', json={'action': 'more', 'cursor': first['cursor']})
        self.assertEqual(more.status_code, 200)
        self.assertEqual(len(more.json()['papers']), 12)
        self.assertFalse({p['id'] for p in first['papers']} & {p['id'] for p in more.json()['papers']})
        restored = await self.client.get('/api/feeds', params={})
        self.assertEqual(restored.json()['interests'], 'robot learning')
        self.assertEqual(restored.json()['papers'], first['papers'])

    async def test_invalid_actions_and_inputs_never_call_provider(self):
        for body in [
            {'userId': 'invalid', 'action': 'refresh'},
            {'action': 'interests', 'interests': ' '},
            {'action': 'refresh', 'interests': 'robotics'},
            {'action': 'more'},
        ]:
            response = await self.client.post('/api/feeds', json=body)
            self.assertIn(response.status_code, [400, 422])
        self.assertEqual(self.source.calls, 0)

    async def test_missing_storage_configuration_returns_recoverable_error(self):
        with patch('app.routers.feeds.limiter.claim_request', AsyncMock(side_effect=SupabaseConfigError('missing config'))):
            response = await self.client.post('/api/feeds', json={'action': 'refresh'})
        self.assertEqual(response.status_code, 503)
        self.assertNotIn('missing config', response.text)

    async def test_source_selection_and_cursor_scope_over_http(self):
        await self.client.post('/api/feeds', json={'action': 'interests', 'interests': 'robot learning'})
        selected = await self.client.post('/api/feeds', json={'action': 'source', 'source': 'arxiv'})
        self.assertEqual(selected.status_code, 200)
        self.assertEqual(selected.json()['source'], 'arxiv')
        self.assertEqual(len(selected.json()['papers']), 12)
        cursor = selected.json()['cursor']
        wrong = await self.client.post('/api/feeds', json={'action': 'more', 'source': 'openalex', 'cursor': cursor})
        self.assertEqual(wrong.status_code, 409)
        more = await self.client.post('/api/feeds', json={'action': 'more', 'source': 'arxiv', 'cursor': cursor})
        self.assertEqual(more.status_code, 200)
        self.assertFalse({p['id'] for p in selected.json()['papers']} & {p['id'] for p in more.json()['papers']})
        invalid = await self.client.post('/api/feeds', json={'action': 'source', 'source': 'unknown'})
        self.assertEqual(invalid.status_code, 422)

    async def test_public_paper_details_do_not_require_browser_identity(self):
        from tests.test_feeds import paper
        self.service.paper=AsyncMock(return_value=paper(1,abstract='Complete saved abstract'))
        response=await self.client.get('/api/feed-papers/arxiv-2609.00001')
        self.assertEqual(response.status_code,200)
        self.assertEqual(response.json()['abstract'],'Complete saved abstract')
        self.assertNotIn('interests',response.json())
        self.service.paper.assert_awaited_once_with('arxiv-2609.00001')

    async def test_signed_sessions_isolate_feeds_and_reject_uuid_selection(self):
        await self.client.post('/api/feeds', json={'action': 'interests', 'interests': 'robot learning'})
        other = issue_feed_credential()
        headers = {'Authorization': 'Bearer ' + other}
        result = await self.client.get('/api/feeds', headers=headers)
        self.assertEqual(result.json()['papers'], [])
        owner = resolve_feed_actor(self.token)
        self.assertNotEqual(owner, resolve_feed_actor(other))
        self.assertEqual((await self.client.get('/api/feeds', params={'userId': owner}, headers=headers)).status_code, 400)
        self.assertEqual((await self.client.post('/api/feeds', json={'action': 'refresh', 'userId': owner}, headers=headers)).status_code, 422)
        self.assertEqual(len(self.service.repo.rows), 1)

    async def test_missing_forged_expired_and_cookie_only_credentials_cannot_access_feeds(self):
        with patch('app.services.feed_identity.time.time', return_value=1):
            expired = issue_feed_credential()
        forged = self.token[:-1] + ('0' if self.token[-1] != '0' else '1')
        for token in ['', 'not-signed', forged, expired]:
            headers = {'Authorization': 'Bearer ' + token if token else '',
                       'Cookie': 'sediment_feed_session=' + self.token, 'Origin': 'https://untrusted.example'}
            self.assertEqual((await self.client.get('/api/feeds', headers=headers)).status_code, 401)
            self.assertEqual((await self.client.post('/api/feeds', json={'action': 'refresh'}, headers=headers)).status_code, 401)
        self.assertEqual(self.source.calls, 0)
        self.assertEqual(self.service.repo.rows, {})

    async def test_public_paper_endpoint_remains_accessible_without_auth(self):
        from tests.test_feeds import paper
        self.service.paper=AsyncMock(return_value=paper(1))
        response=await self.client.get('/api/feed-papers/arxiv-2609.00001', headers={'Authorization': ''})
        self.assertEqual(response.status_code,200)
