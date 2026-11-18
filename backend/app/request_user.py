from typing import Optional

from fastapi import Header, HTTPException, Query

USER_HEADER = "X-Sediment-User"


def request_user_id(
    header_user_id: Optional[str] = Header(default=None, alias=USER_HEADER),
    query_user_id: Optional[str] = Query(default=None, alias="userId"),
) -> str:
    """The anonymous user ID for a request.

    It works like a password for the user's canvases, so the browser sends it in a header, where it stays out
    of URLs, access logs and browser history. The query parameter is still read so a frontend deployed before
    this change keeps working; drop it once every client sends the header.
    """
    user_id = (header_user_id or query_user_id or "").strip()
    if not user_id:
        raise HTTPException(status_code=400, detail="userId required")
    return user_id
