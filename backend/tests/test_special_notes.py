from __future__ import annotations

import io
import unittest
import uuid
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException
from starlette.datastructures import UploadFile

from app.db.supabase import SupabaseAPIError
from app.routers.persistence import (
    delete_special_note_file,
    get_special_note_file_url,
    list_special_note_files,
    upload_special_note_file,
)
from app.services.special_notes import (
    SPECIAL_NOTE_BUCKET,
    SPECIAL_NOTE_SIGNED_URL_TTL_SECONDS,
    _clean_special_note_filename,
    classify_special_note_upload,
    redact_special_notes_from_shared_graph_data,
)


USER_ID = "11111111-1111-1111-1111-111111111111"
GRAPH_ID = "22222222-2222-2222-2222-222222222222"
FILE_ID = "33333333-3333-3333-3333-333333333333"


def special_note_row(**overrides: object) -> dict[str, object]:
    row: dict[str, object] = {
        "id": FILE_ID,
        "graph_id": GRAPH_ID,
        "user_id": USER_ID,
        "storage_path": f"{USER_ID}/{FILE_ID}.pdf",
        "original_filename": "research.pdf",
        "media_type": "application/pdf",
        "file_kind": "pdf",
        "size_bytes": 12,
        "created_at": "2026-08-18T12:00:00+00:00",
    }
    row.update(overrides)
    return row


class SpecialNoteUploadTests(unittest.TestCase):
    def test_classifies_supported_file_types_from_safe_extensions_and_signatures(self) -> None:
        cases = [
            ("research.PDF", b"%PDF-1.7", "pdf", "application/pdf"),
            ("figure.jpg", b"\xff\xd8\xff\xe0", "image", "image/jpeg"),
            ("figure.png", b"\x89PNG\r\n\x1a\n", "image", "image/png"),
            ("figure.gif", b"GIF89a", "image", "image/gif"),
            ("figure.webp", b"RIFFxxxxWEBP", "image", "image/webp"),
            (
                "data.xlsx",
                b"PK\x03\x04",
                "spreadsheet",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            ),
            ("data.xls", b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1", "spreadsheet", "application/vnd.ms-excel"),
            ("data.ods", b"PK\x03\x04", "spreadsheet", "application/vnd.oasis.opendocument.spreadsheet"),
            ("data.csv", b"column,value\nA,1\n", "spreadsheet", "text/csv"),
        ]

        for filename, content, expected_kind, expected_type in cases:
            with self.subTest(filename=filename):
                clean_name, _extension, file_kind, media_type = classify_special_note_upload(filename, content)
                self.assertEqual(clean_name, filename)
                self.assertEqual(file_kind, expected_kind)
                self.assertEqual(media_type, expected_type)

    def test_rejects_unsupported_extensions_and_mismatched_signatures(self) -> None:
        with self.assertRaisesRegex(ValueError, "PDFs, images, and spreadsheets"):
            classify_special_note_upload("archive.zip", b"PK\x03\x04")

        with self.assertRaisesRegex(ValueError, "contents do not match"):
            classify_special_note_upload("looks-like-a-pdf.pdf", b"not a PDF")

    def test_cleans_untrusted_filenames_and_rejects_invalid_names(self) -> None:
        self.assertEqual(_clean_special_note_filename("../../private/research.pdf"), "research.pdf")
        self.assertEqual(_clean_special_note_filename("folder\\report\x00.pdf"), "report.pdf")

        with self.assertRaisesRegex(ValueError, "valid name"):
            _clean_special_note_filename(f"{'a' * 252}.pdf")
        with self.assertRaisesRegex(ValueError, "PDFs, images, and spreadsheets"):
            classify_special_note_upload("untitled", b"not relevant")


class SpecialNotePersistenceRouterTests(unittest.IsolatedAsyncioTestCase):
    async def test_list_scopes_files_and_usage_to_the_authenticated_graph_owner(self) -> None:
        db = AsyncMock()
        db.get_graph.return_value = {"id": GRAPH_ID}
        db.list_special_note_files.return_value = [special_note_row()]
        db.get_special_note_storage_usage.return_value = 4_096

        with patch("app.routers.persistence.get_db", return_value=db):
            response = await list_special_note_files(GRAPH_ID.upper(), USER_ID.upper())

        db.get_graph.assert_awaited_once_with(GRAPH_ID, USER_ID)
        db.list_special_note_files.assert_awaited_once_with(GRAPH_ID, USER_ID)
        db.get_special_note_storage_usage.assert_awaited_once_with(USER_ID)
        self.assertEqual(response.usedBytes, 4_096)
        self.assertEqual(response.items[0].model_dump(), {
            "id": FILE_ID,
            "filename": "research.pdf",
            "mediaType": "application/pdf",
            "fileType": "pdf",
            "sizeBytes": 12,
            "createdAt": "2026-08-18T12:00:00+00:00",
        })

    async def test_upload_reserves_owner_scoped_path_then_uploads_private_object(self) -> None:
        content = b"%PDF-1.7\nhello"
        db = AsyncMock()
        db.get_graph.return_value = {"id": GRAPH_ID}
        db.reserve_special_note_file.return_value = special_note_row(size_bytes=len(content))
        upload = UploadFile(filename="research.PDF", file=io.BytesIO(content))

        with patch("app.routers.persistence.get_db", return_value=db):
            with patch("app.routers.persistence.uuid.uuid4", return_value=uuid.UUID(FILE_ID)):
                response = await upload_special_note_file(GRAPH_ID, USER_ID, upload)

        expected_path = f"{USER_ID}/{FILE_ID}.pdf"
        db.reserve_special_note_file.assert_awaited_once_with({
            "p_graph_id": GRAPH_ID,
            "p_user_id": USER_ID,
            "p_storage_path": expected_path,
            "p_original_filename": "research.PDF",
            "p_media_type": "application/pdf",
            "p_file_kind": "pdf",
            "p_size_bytes": len(content),
        })
        db.upload_storage_object.assert_awaited_once_with(
            SPECIAL_NOTE_BUCKET,
            expected_path,
            content,
            "application/pdf",
        )
        self.assertEqual(response.id, FILE_ID)
        self.assertEqual(response.filename, "research.pdf")

    async def test_upload_releases_its_reservation_when_private_storage_write_fails(self) -> None:
        content = b"%PDF-1.7\nhello"
        db = AsyncMock()
        db.get_graph.return_value = {"id": GRAPH_ID}
        db.reserve_special_note_file.return_value = special_note_row(size_bytes=len(content))
        db.upload_storage_object.side_effect = SupabaseAPIError("storage unavailable")
        upload = UploadFile(filename="research.pdf", file=io.BytesIO(content))

        with patch("app.routers.persistence.get_db", return_value=db):
            with patch("app.routers.persistence.uuid.uuid4", return_value=uuid.UUID(FILE_ID)):
                with self.assertLogs("app.routers.persistence", level="WARNING"):
                    with self.assertRaises(HTTPException) as raised:
                        await upload_special_note_file(GRAPH_ID, USER_ID, upload)

        self.assertEqual(raised.exception.status_code, 502)
        db.delete_special_note_file.assert_awaited_once_with(GRAPH_ID, USER_ID, FILE_ID)

    async def test_upload_returns_a_clear_quota_error_without_attempting_storage_write(self) -> None:
        db = AsyncMock()
        db.get_graph.return_value = {"id": GRAPH_ID}
        db.reserve_special_note_file.side_effect = SupabaseAPIError(
            "special note quota exceeded",
            status_code=400,
            sqlstate="22023",
        )
        upload = UploadFile(filename="research.pdf", file=io.BytesIO(b"%PDF-1.7\nhello"))

        with patch("app.routers.persistence.get_db", return_value=db):
            with patch("app.routers.persistence.uuid.uuid4", return_value=uuid.UUID(FILE_ID)):
                with self.assertRaises(HTTPException) as raised:
                    await upload_special_note_file(GRAPH_ID, USER_ID, upload)

        self.assertEqual(raised.exception.status_code, 409)
        self.assertIn("Delete a previous special note", raised.exception.detail)
        db.upload_storage_object.assert_not_awaited()

    async def test_upload_checks_graph_ownership_before_reading_the_file(self) -> None:
        db = AsyncMock()
        db.get_graph.return_value = None
        upload = AsyncMock()
        upload.filename = "research.pdf"

        with patch("app.routers.persistence.get_db", return_value=db):
            with self.assertRaises(HTTPException) as raised:
                await upload_special_note_file(GRAPH_ID, USER_ID, upload)

        self.assertEqual(raised.exception.status_code, 404)
        upload.read.assert_not_awaited()
        upload.close.assert_awaited_once()
        db.reserve_special_note_file.assert_not_awaited()

    async def test_signed_url_uses_only_the_owner_scoped_file_row(self) -> None:
        db = AsyncMock()
        db.get_special_note_file.return_value = special_note_row()
        db.create_storage_signed_url.return_value = "https://storage.example/signed/private-file"

        with patch("app.routers.persistence.get_db", return_value=db):
            response = await get_special_note_file_url(GRAPH_ID, FILE_ID, USER_ID)

        db.get_special_note_file.assert_awaited_once_with(GRAPH_ID, USER_ID, FILE_ID)
        db.create_storage_signed_url.assert_awaited_once_with(
            SPECIAL_NOTE_BUCKET,
            f"{USER_ID}/{FILE_ID}.pdf",
            SPECIAL_NOTE_SIGNED_URL_TTL_SECONDS,
        )
        self.assertEqual(response.url, "https://storage.example/signed/private-file")

    async def test_signed_url_returns_not_found_without_creating_a_storage_url(self) -> None:
        db = AsyncMock()
        db.get_special_note_file.return_value = None

        with patch("app.routers.persistence.get_db", return_value=db):
            with self.assertRaises(HTTPException) as raised:
                await get_special_note_file_url(GRAPH_ID, FILE_ID, USER_ID)

        self.assertEqual(raised.exception.status_code, 404)
        db.create_storage_signed_url.assert_not_awaited()

    async def test_delete_removes_the_private_storage_object_after_its_database_record(self) -> None:
        db = AsyncMock()
        db.delete_special_note_file.return_value = special_note_row()

        with patch("app.routers.persistence.get_db", return_value=db):
            response = await delete_special_note_file(GRAPH_ID, FILE_ID, USER_ID)

        self.assertIsNone(response)
        db.delete_special_note_file.assert_awaited_once_with(GRAPH_ID, USER_ID, FILE_ID)
        db.delete_storage_object.assert_awaited_once_with(
            SPECIAL_NOTE_BUCKET,
            f"{USER_ID}/{FILE_ID}.pdf",
        )

    async def test_delete_returns_not_found_without_removing_a_storage_object(self) -> None:
        db = AsyncMock()
        db.delete_special_note_file.return_value = None

        with patch("app.routers.persistence.get_db", return_value=db):
            with self.assertRaises(HTTPException) as raised:
                await delete_special_note_file(GRAPH_ID, FILE_ID, USER_ID)

        self.assertEqual(raised.exception.status_code, 404)
        db.delete_storage_object.assert_not_awaited()


class SharedGraphSpecialNotePrivacyTests(unittest.TestCase):
    def test_private_special_notes_and_edges_are_removed_from_shared_graph_data(self) -> None:
        data = {
            "notes": {
                "ordinary": {"id": "ordinary", "kind": "field_note", "text": "Visible note"},
                "private": {
                    "id": "private",
                    "kind": "special_note",
                    "text": "private.pdf",
                    "specialNote": {"id": "file-1"},
                },
            },
            "noteEdges": [
                {"noteId": "ordinary", "nodeId": 1},
                {"noteId": "private", "nodeId": 1},
            ],
        }

        shared = redact_special_notes_from_shared_graph_data(data)

        self.assertEqual(set(shared["notes"]), {"ordinary"})
        self.assertEqual(shared["noteEdges"], [{"noteId": "ordinary", "nodeId": 1}])
        self.assertIn("private", data["notes"])


if __name__ == "__main__":
    unittest.main()
