"""Account-only routes. Phase A5: claiming the work an anonymous browser made before signing in."""

import logging
import json
from typing import Any, Optional

from fastapi import APIRouter, Body, Depends, Header, HTTPException

from ..actor import Actor, current_account
from ..db.supabase import SupabaseAPIError, SupabaseClient
from ..request_user import USER_HEADER
from .persistence import _normalise_uuid, get_db

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/account/claim")
async def claim_browser_work(
    account: Actor = Depends(current_account),
    browser_id: Optional[str] = Header(default=None, alias=USER_HEADER),
    db: SupabaseClient = Depends(get_db),
):
    """Moves this browser's canvases, chats, note files and feed onto the signed-in account.

    A browser can be claimed by one account only; repeating the claim for the same account is safe and picks up
    anything created since. The browser ID is the secret the browser already uses to reach its anonymous work.
    """
    if not browser_id:
        return {"status": "nothing"}
    browser = _normalise_uuid(browser_id, "browserId")
    owner = _normalise_uuid(account.id, "accountId")
    try:
        result = await db.rpc("claim_browser_work", {"p_browser_id": browser, "p_account_id": owner})
    except SupabaseAPIError as exc:
        logger.warning("Claiming browser work failed", exc_info=exc)
        raise HTTPException(status_code=502, detail="Could not move your canvases to your account.") from exc
    if isinstance(result, list):
        result = result[0] if result else {}
    if (result or {}).get("status") == "taken":
        raise HTTPException(status_code=409, detail="This browser's canvases already belong to another account.")
    return result


MAX_CATEGORIES = 200
MAX_LAYOUT_BYTES = 256 * 1024


@router.get("/account/workspaces")
async def get_workspace_layout(account: Actor = Depends(current_account), db: SupabaseClient = Depends(get_db)):
    """The account's Workspaces categories (names, looks, columns and which canvases sit in each).
    `null` when the account has never saved any, so the browser can upload what it has."""
    try:
        return {"categories": await db.get_workspace_layout(_normalise_uuid(account.id, "accountId"))}
    except SupabaseAPIError as exc:
        raise HTTPException(status_code=502, detail="Could not load your workspaces.") from exc


@router.put("/account/workspaces")
async def save_workspace_layout(
    categories: list[Any] = Body(..., embed=True),
    account: Actor = Depends(current_account),
    db: SupabaseClient = Depends(get_db),
):
    # The browser validates entries when it reads them; here only bound the size.
    if len(categories) > MAX_CATEGORIES or len(json.dumps(categories)) > MAX_LAYOUT_BYTES:
        raise HTTPException(status_code=413, detail="Too many workspace categories.")
    if not all(isinstance(entry, dict) for entry in categories):
        raise HTTPException(status_code=400, detail="Each category must be an object.")
    try:
        await db.save_workspace_layout(_normalise_uuid(account.id, "accountId"), categories)
    except SupabaseAPIError as exc:
        raise HTTPException(status_code=502, detail="Could not save your workspaces.") from exc
    return {"ok": True}
