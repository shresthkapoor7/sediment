import logging
import secrets
import uuid

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile

from ..config import settings as app_settings
from ..db.supabase import SupabaseAPIError, SupabaseClient, SupabaseConfigError
from ..services.special_notes import (
    SPECIAL_NOTE_BUCKET,
    SPECIAL_NOTE_SIGNED_URL_TTL_SECONDS,
    classify_special_note_upload,
    format_special_note_storage_quota,
    redact_special_notes_from_shared_graph_data,
)
from ..models import (
    GraphListItem,
    GraphListResponse,
    GraphRecord,
    SaveGraphRequest,
    SharedGraphRecord,
    ShareGraphResponse,
    SpecialNoteFile,
    SpecialNoteFileListResponse,
    SpecialNoteFileUrl,
    UpdateGraphRequest,
    UserRecord,
    UserUpsertRequest,
)

router = APIRouter()
logger = logging.getLogger(__name__)


def _normalise_uuid(value: str, field_name: str) -> str:
    try:
        return str(uuid.UUID(value.strip()))
    except (AttributeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=f"{field_name} must be a valid UUID.") from exc


def get_db() -> SupabaseClient:
    try:
        return SupabaseClient()
    except SupabaseConfigError as e:
        logger.error("Supabase configuration error", exc_info=e)
        raise HTTPException(status_code=503, detail="Persistence service is not configured.") from e


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


def to_special_note_file(row: dict) -> SpecialNoteFile:
    return SpecialNoteFile(
        id=row["id"],
        filename=row["original_filename"],
        mediaType=row["media_type"],
        fileType=row["file_kind"],
        sizeBytes=row["size_bytes"],
        createdAt=row["created_at"],
    )


@router.post("/users", response_model=UserRecord)
async def upsert_user(req: UserUpsertRequest):
    if not req.id.strip():
        raise HTTPException(status_code=400, detail="id required")

    try:
        row = await get_db().upsert_user(req.id.strip())
    except SupabaseAPIError as e:
        logger.warning("User upsert failed for user_id=%r", req.id, exc_info=e)
        raise HTTPException(status_code=502, detail="Persistence service is currently unavailable.") from e

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
        logger.warning("Graph create failed for user_id=%r", req.userId, exc_info=e)
        raise HTTPException(status_code=502, detail="Failed to save graph.") from e

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

    try:
        row = await get_db().update_graph(graph_id, req.userId.strip(), payload)
    except SupabaseAPIError as e:
        logger.warning("Graph update failed for graph_id=%r user_id=%r", graph_id, req.userId, exc_info=e)
        raise HTTPException(status_code=502, detail="Failed to update graph.") from e

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
        logger.warning("Graph lookup failed before share for graph_id=%r user_id=%r", graph_id, userId, exc_info=e)
        raise HTTPException(status_code=502, detail="Failed to load graph.") from e

    if not existing:
        raise HTTPException(status_code=404, detail="graph not found")

    share_id = existing.get("share_id") or secrets.token_urlsafe(6)

    if not existing.get("share_id"):
        try:
            updated = await db.share_graph(graph_id, userId.strip(), share_id)
        except SupabaseAPIError as e:
            logger.warning("Graph share failed for graph_id=%r user_id=%r", graph_id, userId, exc_info=e)
            raise HTTPException(status_code=502, detail="Failed to create share link.") from e

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
        logger.warning("Shared graph lookup failed for share_id=%r", share_id, exc_info=e)
        raise HTTPException(status_code=502, detail="Failed to load shared graph.") from e

    if not row:
        raise HTTPException(status_code=404, detail="shared graph not found")

    return SharedGraphRecord(
        id=row["id"],
        query=row["query"],
        data=redact_special_notes_from_shared_graph_data(row["data"]),
        metadata=row.get("metadata") or {},
        seedPaperId=row.get("seed_paper_id"),
        isPublic=row.get("is_public", True),
        shareId=row.get("share_id"),
        createdAt=row["created_at"],
        updatedAt=row["updated_at"],
    )


@router.get("/graphs", response_model=GraphListResponse)
async def list_graphs(
    userId: str = Query(...),
    limit: int = Query(10, ge=1, le=50),
    offset: int = Query(0, ge=0),
):
    if not userId.strip():
        raise HTTPException(status_code=400, detail="userId required")

    fetch_limit = limit + 1
    try:
        rows = await get_db().list_graphs(userId.strip(), limit=fetch_limit, offset=offset)
    except SupabaseAPIError as e:
        logger.warning("Graph list failed for user_id=%r", userId, exc_info=e)
        raise HTTPException(status_code=502, detail="Failed to list graphs.") from e

    page_rows = rows[:limit]
    return GraphListResponse(
        items=[
            GraphListItem(
                id=row["id"],
                query=row["query"],
                seedPaperId=row.get("seed_paper_id"),
                metadata=row.get("metadata") or {},
                createdAt=row["created_at"],
                updatedAt=row["updated_at"],
            )
            for row in page_rows
        ],
        hasMore=len(rows) > limit,
        nextOffset=offset + len(page_rows) if len(rows) > limit else None,
    )


@router.get("/graphs/{graph_id}", response_model=GraphRecord)
async def get_graph(graph_id: str, userId: str = Query(...)):
    if not userId.strip():
        raise HTTPException(status_code=400, detail="userId required")

    try:
        row = await get_db().get_graph(graph_id, userId.strip())
    except SupabaseAPIError as e:
        logger.warning("Graph fetch failed for graph_id=%r user_id=%r", graph_id, userId, exc_info=e)
        raise HTTPException(status_code=502, detail="Failed to load graph.") from e

    if not row:
        raise HTTPException(status_code=404, detail="graph not found")

    return to_graph_record(row)


@router.get("/graphs/{graph_id}/special-notes", response_model=SpecialNoteFileListResponse)
async def list_special_note_files(graph_id: str, userId: str = Query(...)):
    user_id = _normalise_uuid(userId, "userId")
    graph_id = _normalise_uuid(graph_id, "graphId")
    try:
        db = get_db()
        graph = await db.get_graph(graph_id, user_id)
        if not graph:
            raise HTTPException(status_code=404, detail="graph not found")
        rows = await db.list_special_note_files(graph_id, user_id)
        used_bytes = await db.get_special_note_storage_usage(user_id)
    except SupabaseAPIError as e:
        logger.warning("Special note list failed for graph_id=%r user_id=%r", graph_id, user_id, exc_info=e)
        raise HTTPException(status_code=502, detail="Failed to load special notes.") from e

    return SpecialNoteFileListResponse(
        items=[to_special_note_file(row) for row in rows],
        usedBytes=used_bytes,
        limitBytes=app_settings.special_note_storage_quota_bytes,
    )


@router.post("/graphs/{graph_id}/special-notes", response_model=SpecialNoteFile, status_code=201)
async def upload_special_note_file(
    graph_id: str,
    userId: str = Form(...),
    file: UploadFile = File(...),
):
    user_id = _normalise_uuid(userId, "userId")
    graph_id = _normalise_uuid(graph_id, "graphId")
    try:
        try:
            db = get_db()
            graph = await db.get_graph(graph_id, user_id)
        except SupabaseAPIError as e:
            logger.warning("Special note graph lookup failed for graph_id=%r user_id=%r", graph_id, user_id, exc_info=e)
            raise HTTPException(status_code=502, detail="Failed to load graph.") from e
        if not graph:
            raise HTTPException(status_code=404, detail="graph not found")
        content = await file.read(app_settings.special_note_storage_quota_bytes + 1)
    finally:
        await file.close()

    if not content:
        raise HTTPException(status_code=400, detail="Choose a non-empty file.")
    if len(content) > app_settings.special_note_storage_quota_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"A special note file cannot exceed {format_special_note_storage_quota(app_settings.special_note_storage_quota_bytes)}.",
        )

    try:
        filename, extension, file_kind, media_type = classify_special_note_upload(file.filename or "", content)
    except ValueError as e:
        raise HTTPException(status_code=415, detail=str(e)) from e

    file_id = str(uuid.uuid4())
    storage_path = f"{user_id}/{file_id}{extension}"
    reservation = {
        "p_graph_id": graph_id,
        "p_user_id": user_id,
        "p_storage_path": storage_path,
        "p_original_filename": filename,
        "p_media_type": media_type,
        "p_file_kind": file_kind,
        "p_size_bytes": len(content),
    }
    try:
        row = await db.reserve_special_note_file(reservation)
    except SupabaseAPIError as e:
        if e.sqlstate == "22023":
            quota = format_special_note_storage_quota(app_settings.special_note_storage_quota_bytes)
            raise HTTPException(status_code=409, detail=f"Your {quota} special note storage is full. Delete a previous special note to add this file.") from e
        if e.sqlstate == "P0002":
            raise HTTPException(status_code=404, detail="graph not found") from e
        logger.warning("Special note reservation failed for graph_id=%r user_id=%r", graph_id, user_id, exc_info=e)
        raise HTTPException(status_code=502, detail="Failed to reserve special note storage.") from e

    try:
        await db.upload_storage_object(SPECIAL_NOTE_BUCKET, storage_path, content, media_type)
    except SupabaseAPIError as e:
        logger.warning("Special note upload failed for file_id=%r", file_id, exc_info=e)
        try:
            await db.delete_special_note_file(graph_id, user_id, file_id)
        except SupabaseAPIError:
            logger.exception("Could not release failed special note reservation for file_id=%r", file_id)
        raise HTTPException(status_code=502, detail="Failed to upload special note file.") from e

    return to_special_note_file(row)


@router.get("/graphs/{graph_id}/special-notes/{file_id}/url", response_model=SpecialNoteFileUrl)
async def get_special_note_file_url(graph_id: str, file_id: str, userId: str = Query(...)):
    user_id = _normalise_uuid(userId, "userId")
    graph_id = _normalise_uuid(graph_id, "graphId")
    file_id = _normalise_uuid(file_id, "fileId")
    try:
        db = get_db()
        row = await db.get_special_note_file(graph_id, user_id, file_id)
        if not row:
            raise HTTPException(status_code=404, detail="special note file not found")
        url = await db.create_storage_signed_url(
            SPECIAL_NOTE_BUCKET,
            row["storage_path"],
            SPECIAL_NOTE_SIGNED_URL_TTL_SECONDS,
        )
    except SupabaseAPIError as e:
        logger.warning("Special note URL request failed for file_id=%r", file_id, exc_info=e)
        raise HTTPException(status_code=502, detail="Failed to open special note file.") from e
    return SpecialNoteFileUrl(url=url)


@router.delete("/graphs/{graph_id}/special-notes/{file_id}", status_code=204)
async def delete_special_note_file(graph_id: str, file_id: str, userId: str = Query(...)):
    user_id = _normalise_uuid(userId, "userId")
    graph_id = _normalise_uuid(graph_id, "graphId")
    file_id = _normalise_uuid(file_id, "fileId")
    try:
        db = get_db()
        row = await db.delete_special_note_file(graph_id, user_id, file_id)
    except SupabaseAPIError as e:
        logger.warning("Special note deletion failed for file_id=%r", file_id, exc_info=e)
        raise HTTPException(status_code=502, detail="Failed to delete special note file.") from e
    if not row:
        raise HTTPException(status_code=404, detail="special note file not found")

    try:
        await db.delete_storage_object(SPECIAL_NOTE_BUCKET, row["storage_path"])
    except SupabaseAPIError:
        logger.exception("Special note storage object cleanup failed for file_id=%r", file_id)


@router.delete("/graphs/{graph_id}", status_code=204)
async def delete_graph(graph_id: str, userId: str = Query(...)):
    if not userId.strip():
        raise HTTPException(status_code=400, detail="userId required")

    try:
        db = get_db()
        row = await db.soft_delete_graph(graph_id, userId.strip())
        if row:
            special_note_files = await db.delete_special_note_files_for_graph(graph_id, userId.strip())
            for special_note_file in special_note_files:
                try:
                    await db.delete_storage_object(SPECIAL_NOTE_BUCKET, special_note_file["storage_path"])
                except SupabaseAPIError:
                    logger.exception(
                        "Special note storage cleanup failed while deleting graph_id=%r file_id=%r",
                        graph_id,
                        special_note_file["id"],
                    )
    except SupabaseAPIError as e:
        logger.warning("Graph deletion failed for graph_id=%r user_id=%r", graph_id, userId, exc_info=e)
        raise HTTPException(status_code=502, detail="Failed to delete graph.") from e

    if not row:
        raise HTTPException(status_code=404, detail="graph not found")
