from __future__ import annotations

import unittest

from app.services.special_notes import (
    classify_special_note_upload,
    redact_special_notes_from_shared_graph_data,
)


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
