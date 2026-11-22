"""Anonymous feed credentials, sent in the X-Sediment-Feed header (Authorization carries the account token)."""
import hashlib
import hmac
import re
import secrets
import time
from uuid import UUID

from fastapi import HTTPException, Request

from ..config import settings

SESSION_SECONDS = 180 * 24 * 60 * 60


def _sign(value: str) -> str:
    return hmac.new(settings.actor_key_secret.get_secret_value().encode(), value.encode(), hashlib.sha256).hexdigest()


def issue_feed_credential() -> str:
    payload = f'v1.{int(time.time()) + SESSION_SECONDS}.{secrets.token_hex(32)}'
    return payload + '.' + _sign('feed-session:' + payload)


def resolve_feed_actor(credential: str) -> str:
    if not re.fullmatch(r'v1\.[0-9]{1,12}\.[a-f0-9]{64}\.[a-f0-9]{64}', credential):
        raise HTTPException(401, 'A valid feed session is required.')
    version, expires, nonce, signature = credential.split('.')
    payload = f'{version}.{expires}.{nonce}'
    if not hmac.compare_digest(signature, _sign('feed-session:' + payload)) or int(expires) <= time.time():
        raise HTTPException(401, 'Your feed session expired. Reload the feed.')
    # Neither the credential nor a request UUID chooses the database owner key.
    return str(UUID(hex=_sign('feed-actor:' + nonce)[:32]))


FEED_HEADER = 'X-Sediment-Feed'


def require_feed_actor(request: Request) -> str:
    # Cookies are deliberately not an authentication input. Browsers must send this custom header explicitly,
    # which a cross-site form cannot do, so ambient cookies cannot authorize CSRF.
    credential = request.headers.get(FEED_HEADER, '').strip()
    if not credential:
        raise HTTPException(401, 'A valid feed session is required.')
    return resolve_feed_actor(credential)
