"""Who is making a request: a signed-in account or an anonymous browser.

Every route asks for `Depends(current_actor)` instead of reading a user ID itself, so the rules for telling the
two apart (and the limits each gets) live here and in the usage limiter, not in the routes.
"""

from __future__ import annotations

import asyncio
import logging
import threading
import uuid
import time
from dataclasses import dataclass
from functools import lru_cache
from typing import Literal, Optional

import jwt
from fastapi import Depends, Header, HTTPException, Query, Request

from .config import settings
from .request_ip import get_request_ip
from .request_user import USER_HEADER

logger = logging.getLogger(__name__)

ActorKind = Literal["account", "browser"]
MAX_ID_LENGTH = 128


@dataclass(frozen=True)
class Actor:
    kind: ActorKind
    # The Supabase user ID for an account, the anonymous ID for a browser. Rows are owned by this value.
    id: str
    ip: str
    email: Optional[str] = None
    # Set when the token came from an OAuth client (an MCP app) rather than Sediment's own sign-in.
    client_id: Optional[str] = None

    @property
    def is_account(self) -> bool:
        return self.kind == "account"

    @property
    def usage_key(self) -> str:
        """What usage is counted against. Hashed by the limiter before it is stored."""
        return f"{self.kind}:{self.id}"


@lru_cache(maxsize=1)
def _jwks_client() -> jwt.PyJWKClient:
    base = settings.supabase_url.rstrip("/")
    return jwt.PyJWKClient(f"{base}/auth/v1/.well-known/jwks.json", cache_keys=True, lifespan=3600, timeout=5)


# Signing keys by `kid`. A token naming an unknown `kid` may fetch the JWKS again (key rotation), but at most once
# per JWKS_REFRESH_SECONDS across all requests, so unauthenticated junk tokens cannot turn into a stream of
# blocking fetches.
JWKS_REFRESH_SECONDS = 300
_signing_keys: dict[str, object] = {}
_last_jwks_fetch = 0.0
_jwks_lock = threading.Lock()


def _signing_key(token: str):
    global _last_jwks_fetch
    kid = jwt.get_unverified_header(token).get("kid")
    if not kid:
        raise jwt.InvalidTokenError("token has no kid")
    key = _signing_keys.get(kid)
    if key is not None:
        return key
    with _jwks_lock:
        key = _signing_keys.get(kid)
        if key is not None:
            return key
        if time.monotonic() - _last_jwks_fetch < JWKS_REFRESH_SECONDS and _signing_keys:
            raise jwt.InvalidTokenError("unknown kid")
        _last_jwks_fetch = time.monotonic()
        for jwk in _jwks_client().get_signing_keys(refresh=True):
            _signing_keys[jwk.key_id] = jwk.key
        key = _signing_keys.get(kid)
    if key is None:
        raise jwt.InvalidTokenError("unknown kid")
    return key


def _decode(token: str) -> dict:
    """Checks a Supabase access token. Asymmetric project keys come from the JWKS endpoint (cached);
    projects still on the legacy shared secret set SUPABASE_JWT_SECRET instead."""
    options = {"require": ["exp", "sub"]}
    secret = settings.supabase_jwt_secret.get_secret_value()
    algorithm = jwt.get_unverified_header(token).get("alg")
    if algorithm == "HS256":
        if not secret:
            raise jwt.InvalidTokenError("HS256 token but no SUPABASE_JWT_SECRET is configured")
        return jwt.decode(token, secret, algorithms=["HS256"], audience="authenticated", options=options)
    return jwt.decode(token, _signing_key(token), algorithms=["ES256", "RS256"], audience="authenticated", options=options)


async def verify_access_token(token: str) -> dict:
    try:
        # The JWKS fetch is blocking network I/O on a cache miss, so keep it off the event loop.
        return await asyncio.to_thread(_decode, token)
    except jwt.PyJWTError as e:
        raise HTTPException(status_code=401, detail="Your session has expired. Sign in again.") from e
    except Exception as e:  # JWKS unreachable and similar
        logger.warning("Access token verification failed", exc_info=e)
        raise HTTPException(status_code=503, detail="Sign-in check is unavailable.") from e


def _browser_id(header_value: Optional[str], query_value: Optional[str]) -> str:
    browser_id = (header_value or "").strip() or (query_value or "").strip()
    if not browser_id:
        raise HTTPException(status_code=400, detail="userId required")
    if len(browser_id) > MAX_ID_LENGTH:
        raise HTTPException(status_code=400, detail="userId too long")
    return browser_id


async def current_actor(
    request: Request,
    authorization: Optional[str] = Header(default=None),
    header_user_id: Optional[str] = Header(default=None, alias=USER_HEADER),
    query_user_id: Optional[str] = Query(default=None, alias="userId"),
) -> Actor:
    """A valid Bearer token makes the caller an account; anything else falls back to the browser ID.

    A token that is present but invalid is an error rather than a silent fall back to anonymous, so an expired
    session never quietly writes into the browser's anonymous space.
    """
    ip = get_request_ip(request)
    if authorization is not None and authorization.strip():
        # Credentials were supplied, so they must be valid: never fall back to the anonymous browser space.
        scheme, _, token = authorization.strip().partition(" ")
        if scheme.lower() != "bearer" or not token.strip():
            raise HTTPException(status_code=401, detail="Your session has expired. Sign in again.")
        claims = await verify_access_token(token.strip())
        return Actor(kind="account", id=str(claims["sub"]), ip=ip, email=claims.get("email"), client_id=claims.get("client_id"))
    browser_id = _browser_id(header_user_id, query_user_id)
    if await is_account_id(browser_id):
        # Account-owned rows use the account's ID as owner; a browser ID equal to one would reach them unsigned.
        raise HTTPException(status_code=401, detail="Sign in to open this.")
    return Actor(kind="browser", id=browser_id, ip=ip)


# Whether an ID belongs to a signed-in account (auth.users). Positives never change; negatives are rechecked
# after a while since a browser ID can't become an account, but a fresh account ID could be probed early.
_ACCOUNT_CACHE: dict[str, tuple[bool, float]] = {}
_NEGATIVE_TTL = 600.0


async def is_account_id(candidate: str) -> bool:
    try:
        candidate = str(uuid.UUID(candidate))
    except ValueError:
        return False  # account IDs are UUIDs
    cached = _ACCOUNT_CACHE.get(candidate)
    now = time.monotonic()
    if cached and (cached[0] or now - cached[1] < _NEGATIVE_TTL):
        return cached[0]
    from .db.supabase import SupabaseClient  # local import: the DB client imports settings at module load
    try:
        result = await SupabaseClient().rpc("is_account_id", {"p_id": candidate})
    except Exception as e:  # unknown → treat as browser but don't cache, so it is checked again
        logger.warning("Account ID check failed", exc_info=e)
        return False
    found = bool(result)
    if len(_ACCOUNT_CACHE) > 50_000:
        _ACCOUNT_CACHE.clear()
    _ACCOUNT_CACHE[candidate] = (found, now)
    return found


async def current_account(
    request: Request,
    authorization: Optional[str] = Header(default=None),
) -> Actor:
    """For routes that only make sense signed in (the account page, claiming anonymous work)."""
    scheme, _, token = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise HTTPException(status_code=401, detail="Sign in to continue.")
    claims = await verify_access_token(token.strip())
    return Actor(kind="account", id=str(claims["sub"]), ip=get_request_ip(request), email=claims.get("email"), client_id=claims.get("client_id"))


def owned_by(req, actor: Actor):
    """The request with its `userId` replaced by the caller's identity.

    Bodies used to name their owner, so anyone could read or write as any user. The value in the body is now
    ignored; requests that carry no canvas (`graphId` empty) keep `userId` empty as their models require.
    """
    if getattr(req, "graphId", "present") is None:
        return req
    return req.model_copy(update={"userId": actor.id})


async def current_actor_id(actor: Actor = Depends(current_actor)) -> str:
    """For routes that only need the owner ID."""
    return actor.id
