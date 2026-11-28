import time
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import jwt
from fastapi import HTTPException
from pydantic import SecretStr

from app import actor as actor_module
from app.actor import Actor, current_actor, current_account, owned_by
from app.config import settings
from app.models import SaveGraphRequest
from app.services.usage_limiter import UsageLimiter, _actor_key

SECRET = "test-jwt-secret-that-is-long-enough-for-hs256"


def request():
    return SimpleNamespace(state=SimpleNamespace(verified_client_ip="10.0.0.1"), client=None)


def token(**claims):
    payload = {"sub": "acct-1", "aud": "authenticated", "exp": int(time.time()) + 600, "email": "r@uni.edu", **claims}
    return jwt.encode(payload, SECRET, algorithm="HS256")


class ActorTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.secret = patch.object(settings, "supabase_jwt_secret", SecretStr(SECRET))
        self.secret.start()

    def tearDown(self):
        self.secret.stop()

    async def test_browser_id_header_makes_an_anonymous_actor(self):
        actor = await current_actor(request(), authorization=None, header_user_id="b-1", query_user_id=None)
        self.assertEqual(actor, Actor(kind="browser", id="b-1", ip="10.0.0.1"))
        self.assertEqual(actor.usage_key, "browser:b-1")

    async def test_valid_token_makes_an_account_even_with_a_browser_id(self):
        actor = await current_actor(request(), authorization=f"Bearer {token()}", header_user_id="b-1", query_user_id=None)
        self.assertEqual((actor.kind, actor.id, actor.email), ("account", "acct-1", "r@uni.edu"))

    async def test_bad_or_expired_token_is_rejected_not_treated_as_anonymous(self):
        for bad in ["nonsense", token(exp=int(time.time()) - 10), token(aud="anon"), jwt.encode({"sub": "x", "aud": "authenticated", "exp": int(time.time()) + 60}, "wrong-secret-also-long-enough-for-hs256", algorithm="HS256")]:
            with self.assertRaises(HTTPException) as caught:
                await current_actor(request(), authorization=f"Bearer {bad}", header_user_id="b-1", query_user_id=None)
            self.assertEqual(caught.exception.status_code, 401)

    async def test_an_empty_or_non_bearer_authorization_header_is_rejected(self):
        for header in ["Bearer ", "Bearer", "Basic abc"]:
            with self.assertRaises(HTTPException) as caught:
                await current_actor(request(), authorization=header, header_user_id="b-1", query_user_id=None)
            self.assertEqual(caught.exception.status_code, 401)

    async def test_a_browser_id_that_is_an_account_id_is_refused(self):
        with patch.object(actor_module, "is_account_id", AsyncMock(return_value=True)):
            with self.assertRaises(HTTPException) as caught:
                await current_actor(request(), authorization=None, header_user_id="acct-uuid", query_user_id=None)
        self.assertEqual(caught.exception.status_code, 401)

    async def test_no_identity_is_a_bad_request(self):
        with self.assertRaises(HTTPException) as caught:
            await current_actor(request(), authorization=None, header_user_id=None, query_user_id=None)
        self.assertEqual(caught.exception.status_code, 400)

    async def test_account_only_routes_need_a_token(self):
        with self.assertRaises(HTTPException) as caught:
            await current_account(request(), authorization=None)
        self.assertEqual(caught.exception.status_code, 401)

    def test_body_user_id_is_replaced_by_the_caller(self):
        req = SaveGraphRequest(userId="someone-else", query="q", data={})
        self.assertEqual(owned_by(req, Actor(kind="account", id="acct-1", ip="1.1.1.1")).userId, "acct-1")


class JwksRefreshTests(unittest.TestCase):
    def test_unknown_kids_refetch_the_key_set_at_most_once_per_window(self):
        client = SimpleNamespace(get_signing_keys=lambda refresh: fetches.append(1) or [SimpleNamespace(key_id="k1", key="KEY")])
        fetches = []
        with patch.object(actor_module, "_jwks_client", return_value=client), \
             patch.object(actor_module, "_signing_keys", {}), patch.object(actor_module, "_last_jwks_fetch", 0.0):
            unknown = jwt.encode({"sub": "x"}, SECRET, algorithm="HS256", headers={"kid": "nope"})
            for _ in range(5):
                with self.assertRaises(jwt.InvalidTokenError):
                    actor_module._signing_key(unknown)
            self.assertEqual(len(fetches), 1)
            known = jwt.encode({"sub": "x"}, SECRET, algorithm="HS256", headers={"kid": "k1"})
            self.assertEqual(actor_module._signing_key(known), "KEY")


class LayeredLimitTests(unittest.IsolatedAsyncioTestCase):
    async def claims(self, actor):
        limiter = UsageLimiter()
        with patch.object(limiter, "_claim", AsyncMock(return_value={})) as claim:
            await limiter.claim_request(actor, "chat")
        return claim.await_args_list

    async def test_browsers_count_against_their_own_budget_and_the_ip_ceiling(self):
        calls = await self.claims(Actor(kind="browser", id="b-1", ip="10.0.0.1"))
        keys = [call.args[0] for call in calls]
        self.assertEqual(len(keys), 2)
        self.assertTrue(keys[0].startswith("iphash:"))
        self.assertEqual(calls[0].args[3], settings.ip_burst_limit_requests)
        self.assertEqual(keys[1], _actor_key("browser:b-1"))
        self.assertEqual(calls[1].args[3], settings.burst_limit_requests)

    async def test_accounts_skip_the_ip_ceiling_and_get_the_account_budget(self):
        calls = await self.claims(Actor(kind="account", id="acct-1", ip="10.0.0.1"))
        self.assertEqual([call.args[0] for call in calls], [_actor_key("account:acct-1")])
        self.assertEqual(calls[0].kwargs["daily_limit_usd"], settings.account_daily_usage_limit_usd)

    def test_browser_and_account_keys_never_collide(self):
        self.assertNotEqual(_actor_key("browser:same"), _actor_key("account:same"))


if __name__ == "__main__":
    unittest.main()
