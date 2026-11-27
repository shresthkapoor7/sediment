import unittest
import uuid
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException

from app.actor import Actor
from app.models import CommitCanvasOpsRequest
from app.routers import persistence

ACTOR = Actor(kind="account", id=str(uuid.uuid4()), ip="1.1.1.1")
GRAPH = str(uuid.uuid4())
REQ = CommitCanvasOpsRequest(baseVersion=4, data={"nodes": {}}, ops=[{"type": "move_node", "nodeId": 1, "x": 0, "y": 0}], via="agent")


class CommitTests(unittest.IsolatedAsyncioTestCase):
    async def commit(self, rpc_result):
        db = AsyncMock()
        db.rpc.return_value = rpc_result
        with patch.object(persistence, "get_db", return_value=db):
            return await persistence.commit_canvas_ops(GRAPH, REQ, actor=ACTOR), db

    async def test_commits_with_the_caller_as_the_actor(self):
        result, db = await self.commit(5)
        self.assertEqual(result.version, 5)
        name, params = db.rpc.await_args.args
        self.assertEqual(name, "commit_canvas_ops")
        self.assertEqual((params["p_user_id"], params["p_actor_kind"], params["p_base_version"], params["p_via"]),
                         (ACTOR.id, "account", 4, "agent"))

    async def test_a_stale_base_version_is_a_conflict(self):
        with self.assertRaises(HTTPException) as caught:
            await self.commit(None)
        self.assertEqual(caught.exception.status_code, 409)


if __name__ == "__main__":
    unittest.main()
