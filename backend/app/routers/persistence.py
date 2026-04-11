import secrets

from fastapi import APIRouter, HTTPException, Query

from ..config import settings as app_settings
from ..db.supabase import SupabaseAPIError, SupabaseClient, SupabaseConfigError
from ..models import (
    GraphListItem,
    GraphRecord,
    SaveGraphRequest,
    SharedGraphRecord,
    ShareGraphResponse,
    UpdateGraphRequest,
    UserRecord,
    UserUpsertRequest,
)

router = APIRouter()


def get_db() -> SupabaseClient:
    try:
        return SupabaseClient()
    except SupabaseConfigError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e


def to_graph_record(row: dict) -> GraphRecord:
    return GraphRecord(
        id=row["id"],
        userId=row["user_id"],
        query=row["query"],
        data=row["data"],
        metadata=row.get("metadata") or {},
        seedPaperId=row.get("seed_paper_id"),
        isPublic=row.get("is_public", False),
        shareId=row.get("share_id"),
        createdAt=row["created_at"],
        updatedAt=row["updated_at"],
    )


@router.post("/users", response_model=UserRecord)
async def upsert_user(req: UserUpsertRequest):
    if not req.id.strip():
        raise HTTPException(status_code=400, detail="id required")

    try:
        row = await get_db().upsert_user(req.id.strip())
    except SupabaseAPIError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e

    return UserRecord(**row)


@router.post("/graphs", response_model=GraphRecord)
async def create_graph(req: SaveGraphRequest):
    if not req.userId.strip():
        raise HTTPException(status_code=400, detail="userId required")
    if not req.query.strip():
        raise HTTPException(status_code=400, detail="query required")

    payload = {
        "user_id": req.userId.strip(),
        "query": req.query.strip(),
        "data": req.data,
        "metadata": req.metadata.model_dump(),
        "seed_paper_id": req.seedPaperId,
    }

    try:
        db = get_db()
        await db.upsert_user(req.userId.strip())
        row = await db.create_graph(payload)
    except SupabaseAPIError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e

    return to_graph_record(row)


@router.patch("/graphs/{graph_id}", response_model=GraphRecord)
async def update_graph(graph_id: str, req: UpdateGraphRequest):
    if not req.userId.strip():
        raise HTTPException(status_code=400, detail="userId required")

    payload = {}
    if req.query is not None:
        query = req.query.strip()
        if not query:
            raise HTTPException(status_code=400, detail="query required")
        payload["query"] = query
    if req.data is not None:
        payload["data"] = req.data
    if req.metadata is not None:
        payload["metadata"] = req.metadata.model_dump()
    if req.seedPaperId is not None:
        payload["seed_paper_id"] = req.seedPaperId

    if not payload:
        raise HTTPException(status_code=400, detail="no fields to update")

    try:
        row = await get_db().update_graph(graph_id, req.userId.strip(), payload)
    except SupabaseAPIError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e

    if not row:
        raise HTTPException(status_code=404, detail="graph not found")

    return to_graph_record(row)


@router.post("/graphs/{graph_id}/share", response_model=ShareGraphResponse)
async def share_graph(graph_id: str, userId: str = Query(...)):
    if not userId.strip():
        raise HTTPException(status_code=400, detail="userId required")

    try:
        db = get_db()
        existing = await db.get_graph(graph_id, userId.strip())
    except SupabaseAPIError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e

    if not existing:
        raise HTTPException(status_code=404, detail="graph not found")

    share_id = existing.get("share_id") or secrets.token_urlsafe(6)

    if not existing.get("share_id"):
        try:
            updated = await db.share_graph(graph_id, userId.strip(), share_id)
        except SupabaseAPIError as e:
            raise HTTPException(status_code=502, detail=str(e)) from e

        if not updated or updated.get("share_id") != share_id:
            raise HTTPException(status_code=502, detail="failed to persist share link")

    app_url = getattr(app_settings, "app_url", "").rstrip("/")
    share_url = f"{app_url}/s/{share_id}" if app_url else f"/s/{share_id}"

    return ShareGraphResponse(shareId=share_id, shareUrl=share_url)


@router.get("/share/{share_id}", response_model=SharedGraphRecord)
async def get_shared_graph(share_id: str):
    try:
        row = await get_db().get_graph_by_share_id(share_id)
    except SupabaseAPIError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e

    if not row:
        raise HTTPException(status_code=404, detail="shared graph not found")

    return SharedGraphRecord(
        id=row["id"],
        query=row["query"],
        data=row["data"],
        metadata=row.get("metadata") or {},
        seedPaperId=row.get("seed_paper_id"),
        isPublic=row.get("is_public", True),
        shareId=row.get("share_id"),
        createdAt=row["created_at"],
        updatedAt=row["updated_at"],
    )


@router.get("/graphs", response_model=list[GraphListItem])
async def list_graphs(userId: str = Query(...)):
    if not userId.strip():
        raise HTTPException(status_code=400, detail="userId required")

    try:
        rows = await get_db().list_graphs(userId.strip())
    except SupabaseAPIError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e

    return [
        GraphListItem(
            id=row["id"],
            query=row["query"],
            seedPaperId=row.get("seed_paper_id"),
            metadata=row.get("metadata") or {},
            createdAt=row["created_at"],
            updatedAt=row["updated_at"],
        )
        for row in rows
    ]


@router.get("/graphs/{graph_id}", response_model=GraphRecord)
async def get_graph(graph_id: str, userId: str = Query(...)):
    if not userId.strip():
        raise HTTPException(status_code=400, detail="userId required")

    try:
        row = await get_db().get_graph(graph_id, userId.strip())
    except SupabaseAPIError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e

    if not row:
        raise HTTPException(status_code=404, detail="graph not found")

    return to_graph_record(row)
