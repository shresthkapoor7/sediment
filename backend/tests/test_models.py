from __future__ import annotations

import unittest

from pydantic import ValidationError

from app.models import GlobalChatResponse


class GlobalChatResponseModelTests(unittest.TestCase):
    def test_note_changes_are_validated_against_the_note_contract(self) -> None:
        response = GlobalChatResponse(
            text="Updated the note.",
            noteChanges=[{
                "createdNotes": [{
                    "id": "note-1",
                    "text": "A note",
                    "kind": "todo",
                    "color": "green",
                }],
                "connections": [{"noteId": "note-1", "paperId": "W1", "relation": "todo"}],
            }],
        )

        self.assertEqual(response.noteChanges[0].createdNotes[0].id, "note-1")
        self.assertEqual(response.noteChanges[0].connections[0].paperId, "W1")

        with self.assertRaises(ValidationError):
            GlobalChatResponse(
                text="Malformed mutation.",
                noteChanges=[{"createdNotes": [{"id": "note-1", "kind": "todo", "color": "green"}]}],
            )
