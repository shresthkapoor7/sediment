"""Who is making a request: a signed-in account or an anonymous browser.

Every route asks for `Depends(current_actor)` instead of reading a user ID itself, so the rules for telling the
two apart (and the limits each gets) live here and in the usage limiter, not in the routes.
"""

from __future__ import annotations

import asyncio
import logging
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
    return jwt.PyJWKClient(f"{base}/auth/v1/.well-known/jwks.json", cache_keys=True, lifespan=3600)


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
    key = _jwks_client().get_signing_key_from_jwt(token)
    return jwt.decode(token, key.key, algorithms=["ES256", "RS256"], audience="authenticated", options=options)


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
    scheme, _, token = (authorization or "").partition(" ")
    if scheme.lower() == "bearer" and token.strip():
        claims = await verify_access_token(token.strip())
        return Actor(kind="account", id=str(claims["sub"]), ip=ip, email=claims.get("email"), client_id=claims.get("client_id"))
    return Actor(kind="browser", id=_browser_id(header_user_id, query_user_id), ip=ip)


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
