import unittest
import uuid
from unittest.mock import AsyncMock

from fastapi import HTTPException

from app.actor import Actor
from app.routers.account import MAX_CATEGORIES, claim_browser_work, get_workspace_layout, save_workspace_layout

ACCOUNT = Actor(kind="account", id=str(uuid.uuid4()), ip="1.1.1.1")
BROWSER = str(uuid.uuid4())


class ClaimTests(unittest.IsolatedAsyncioTestCase):
    async def test_moves_the_browser_onto_the_account(self):
        db = AsyncMock()
        db.rpc.return_value = {"status": "claimed", "graphs": 3}
        result = await claim_browser_work(account=ACCOUNT, browser_id=BROWSER, db=db)
        self.assertEqual(result["graphs"], 3)
        db.rpc.assert_awaited_once_with("claim_browser_work", {"p_browser_id": BROWSER, "p_account_id": ACCOUNT.id})

    async def test_a_browser_claimed_by_someone_else_is_a_conflict(self):
        db = AsyncMock()
        db.rpc.return_value = {"status": "taken"}
        with self.assertRaises(HTTPException) as caught:
            await claim_browser_work(account=ACCOUNT, browser_id=BROWSER, db=db)
        self.assertEqual(caught.exception.status_code, 409)

    async def test_no_browser_id_is_a_no_op(self):
        db = AsyncMock()
        self.assertEqual((await claim_browser_work(account=ACCOUNT, browser_id=None, db=db))["status"], "nothing")
        db.rpc.assert_not_awaited()


class WorkspaceLayoutTests(unittest.IsolatedAsyncioTestCase):
    async def test_round_trip_is_scoped_to_the_account(self):
        db = AsyncMock()
        db.get_workspace_layout.return_value = [{"id": "c", "name": "Reading", "graphIds": []}]
        self.assertEqual((await get_workspace_layout(account=ACCOUNT, db=db))["categories"][0]["name"], "Reading")
        db.get_workspace_layout.assert_awaited_once_with(ACCOUNT.id)
        await save_workspace_layout(categories=[{"id": "c"}], account=ACCOUNT, db=db)
        db.save_workspace_layout.assert_awaited_once_with(ACCOUNT.id, [{"id": "c"}])

    async def test_oversized_layouts_are_refused(self):
        with self.assertRaises(HTTPException) as caught:
            await save_workspace_layout(categories=[{}] * (MAX_CATEGORIES + 1), account=ACCOUNT, db=AsyncMock())
        self.assertEqual(caught.exception.status_code, 413)


if __name__ == "__main__":
    unittest.main()
