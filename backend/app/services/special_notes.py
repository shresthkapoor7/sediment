from __future__ import annotations

from typing import Any

SPECIAL_NOTE_BUCKET = "special-notes"
SPECIAL_NOTE_SIGNED_URL_TTL_SECONDS = 60 * 60

_SPECIAL_NOTE_FILE_TYPES: dict[str, tuple[str, str]] = {
    ".pdf": ("pdf", "application/pdf"),
    ".jpg": ("image", "image/jpeg"),
    ".jpeg": ("image", "image/jpeg"),
    ".png": ("image", "image/png"),
    ".webp": ("image", "image/webp"),
    ".gif": ("image", "image/gif"),
    ".xlsx": ("spreadsheet", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    ".xls": ("spreadsheet", "application/vnd.ms-excel"),
    ".ods": ("spreadsheet", "application/vnd.oasis.opendocument.spreadsheet"),
    ".csv": ("spreadsheet", "text/csv"),
}


def _clean_special_note_filename(filename: str) -> str:
    name = filename.replace("\\", "/").rsplit("/", 1)[-1].strip()
    name = "".join(character for character in name if character.isprintable())
    if not name or len(name) > 255:
        raise ValueError("Choose a file with a valid name.")
    return name


def _validate_special_note_signature(file_kind: str, media_type: str, content: bytes) -> None:
    if file_kind == "pdf" and content.startswith(b"%PDF-"):
        return
    if media_type == "image/jpeg" and content.startswith(b"\xff\xd8\xff"):
        return
    if media_type == "image/png" and content.startswith(b"\x89PNG\r\n\x1a\n"):
        return
    if media_type == "image/gif" and content.startswith((b"GIF87a", b"GIF89a")):
        return
    if media_type == "image/webp" and content.startswith(b"RIFF") and content[8:12] == b"WEBP":
        return
    if media_type in {
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.oasis.opendocument.spreadsheet",
    } and content.startswith(b"PK\x03\x04"):
        return
    if media_type == "application/vnd.ms-excel" and content.startswith(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"):
        return
    if media_type == "text/csv":
        try:
            content.decode("utf-8")
            return
        except UnicodeDecodeError:
            pass
    raise ValueError("The file contents do not match its supported file type.")


def classify_special_note_upload(filename: str, content: bytes) -> tuple[str, str, str, str]:
    clean_name = _clean_special_note_filename(filename)
    extension = f".{clean_name.rsplit('.', 1)[-1].lower()}" if "." in clean_name else ""
    file_type = _SPECIAL_NOTE_FILE_TYPES.get(extension)
    if not file_type:
        raise ValueError("Special notes support PDFs, images, and spreadsheets only.")
    file_kind, media_type = file_type
    _validate_special_note_signature(file_kind, media_type, content)
    return clean_name, extension, file_kind, media_type


def redact_special_notes_from_shared_graph_data(data: dict[str, Any]) -> dict[str, Any]:
    """Special note metadata is private even when a graph has a public share link."""
    notes = data.get("notes")
    if not isinstance(notes, dict):
        return data
    private_note_ids = {
        note_id
        for note_id, note in notes.items()
        if isinstance(note, dict) and (note.get("kind") == "special_note" or "specialNote" in note)
    }
    if not private_note_ids:
        return data
    shared_data = {**data, "notes": {note_id: note for note_id, note in notes.items() if note_id not in private_note_ids}}
    note_edges = data.get("noteEdges")
    if isinstance(note_edges, list):
        shared_data["noteEdges"] = [
            edge for edge in note_edges
            if not isinstance(edge, dict) or edge.get("noteId") not in private_note_ids
        ]
    return shared_data
