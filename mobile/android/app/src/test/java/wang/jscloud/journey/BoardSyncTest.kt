package wang.jscloud.journey

import java.io.File
import java.nio.file.Files
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class BoardSyncTest {
    @Test
    fun normalizeBoardItemHandlesPayloadTopLevelAndUnknownTypes() {
        val raw =
            obj(
                "id" to "item-1",
                "kind" to "boardItem",
                "state" to "active",
                "generation" to 2,
                "payload" to
                    obj(
                        "boardId" to "default-board",
                        "frame" to obj("x" to 10, "y" to 20, "w" to 200, "h" to 120, "rotation" to 0, "scale" to 1),
                        "z" to 5,
                        "content" to obj("type" to "futureType", "customField" to 42),
                        "style" to obj("color" to "yellow", "locked" to true),
                        "linkedActivityId" to null,
                        "createdBy" to "u1",
                    ),
            )

        val norm = normalizeBoardItem(raw)
        assertEquals("default-board", norm.s("boardId"))
        assertEquals(5, norm.optInt("z"))
        assertEquals(200, norm.o("frame").optInt("w"))
        assertEquals("futureType", norm.o("content").s("type"))
        assertEquals(42, norm.o("content").optInt("customField"))
        assertTrue(norm.optBoolean("locked"))
        assertTrue(norm.isNull("linkedActivityId"))
        assertEquals("u1", norm.s("createdBy"))
        assertEquals("default-board", norm.o("payload").s("boardId"))
        assertTrue(norm.o("payload").o("style").optBoolean("locked"))

        // Top-level fields override payload; style.locked == false overrides top-level locked == true.
        val flat =
            normalizeBoardItem(
                obj(
                    "id" to "item-2",
                    "locked" to true,
                    "style" to obj("locked" to false),
                    "content" to obj("type" to "widget", "kind" to "futureWidget"),
                )
            )
        assertFalse(flat.optBoolean("locked"))
        assertEquals("futureWidget", flat.o("content").s("kind"))
        assertEquals(100, flat.o("frame").optInt("w"))
    }

    @Test
    fun cleanBoardItemPatchDropsDisallowedKeysAndNormalizesFrameAndStyle() {
        val cleaned =
            cleanBoardItemPatch(
                obj(
                    "boardId" to "other-board",
                    "createdBy" to "attacker",
                    "unknownTop" to "drop",
                    "locked" to 1,
                    "linkedActivityId" to null,
                    "z" to 7,
                    "frame" to obj("x" to 12, "y" to 24, "w" to 180, "h" to 90),
                    "style" to obj("color" to "blue", "junkStyle" to "x", "mapStyle" to "dark"),
                    "payload" to obj("content" to obj("type" to "note", "text" to "hi")),
                )
            )

        assertFalse(cleaned.has("boardId"))
        assertFalse(cleaned.has("createdBy"))
        assertFalse(cleaned.has("unknownTop"))
        assertTrue(cleaned.has("linkedActivityId"))
        assertTrue(cleaned.isNull("linkedActivityId"))
        assertEquals(7, cleaned.optInt("z"))
        assertEquals(0, cleaned.o("frame").optInt("rotation"))
        assertEquals(1, cleaned.o("frame").optInt("scale"))
        assertEquals("note", cleaned.o("content").s("type"))
        assertEquals("blue", cleaned.o("style").s("color"))
        assertEquals("dark", cleaned.o("style").s("mapStyle"))
        assertTrue(cleaned.o("style").optBoolean("locked"))
        assertFalse(cleaned.o("style").has("junkStyle"))
    }

    @Test
    fun boardListHelpersFollowWebRules() {
        val objects =
            listOf(
                obj("id" to "b2", "kind" to "board", "state" to "active", "payload" to obj("title" to "B", "order" to 2)),
                obj("id" to "b1", "kind" to "board", "state" to "active", "payload" to obj("title" to "A", "order" to 0)),
                obj("id" to "b1b", "kind" to "board", "state" to "active", "payload" to obj("title" to "A2", "order" to 0)),
                obj("id" to "bdel", "kind" to "board", "state" to "deleted", "payload" to obj("title" to "Deleted", "order" to 1)),
            )

        assertEquals(listOf("b1", "b1b", "b2"), activeBoards(objects).map { it.s("id") })
        assertEquals(listOf("bdel"), deletedBoards(objects).map { it.s("id") })
        assertEquals(3.0, nextBoardOrder(objects), 1e-9)
        assertEquals("b2", resolveBoardId(obj("objects" to JSONArray(objects)), "b2"))
        assertEquals("b1", resolveBoardId(obj("objects" to JSONArray(objects)), "missing"))
        assertEquals(DEFAULT_BOARD_ID, resolveBoardId(obj("objects" to JSONArray()), null))
        assertEquals("custom", resolveBoardId(obj("objects" to JSONArray()), "custom"))

        assertTrue(canCreateBoard(objects))
        val twenty = (1..20).map { obj("id" to "b$it", "kind" to "board", "state" to "active") }
        assertFalse(canCreateBoard(twenty))
        assertEquals("每段旅程最多创建 20 块白板", boardFullMessage("board"))
        assertEquals("每块白板最多添加 2000 个对象", boardFullMessage("boardItem"))
    }

    @Test
    fun projectSnapshotSkipsBoardItemWhileProjectingBoard() {
        val snapshot =
            obj(
                "trip" to obj("id" to "t1", "state" to "active", "generation" to 0, "teamMode" to "equal"),
                "members" to JSONArray(),
                "objects" to JSONArray(),
            )
        val queue =
            listOf(
                obj(
                    "tripId" to "t1",
                    "operation" to
                        obj(
                            "kind" to "create",
                            "objectId" to "b1",
                            "objectType" to "board",
                            "patch" to obj("title" to "主白板", "order" to 0, "background" to "dots"),
                        ),
                ),
                obj(
                    "tripId" to "t1",
                    "operation" to
                        obj(
                            "kind" to "create",
                            "objectId" to "item-1",
                            "objectType" to "boardItem",
                            "patch" to obj("boardId" to "b1", "content" to obj("type" to "note", "text" to "hi")),
                        ),
                ),
            )
        val projected = projectSnapshot(snapshot, queue, "u1")
        val ids = projected.a("objects").rows().map { it.s("id") }
        assertEquals(listOf("b1"), ids)
    }

    @Test
    fun boardSyncControllerIncrementalEpochResetStaleDropAndPendingReconcile() {
        runBlocking {
        val server = MockWebServer()
        server.start()
        try {
            val api = JourneyApi(server.url("/").toString().trimEnd('/'), SessionCookies({ "[]" }, {}))
            val cacheDir = Files.createTempDirectory("board-cache-test").toFile()
            val cache = FileBoardCacheStore { cacheDir }
            val queued = mutableListOf<JSONObject>()
            var fakeNow = 10_000L

            val controller =
                BoardSyncController(
                    api = api,
                    cache = cache,
                    enqueueMutation = { kind, objectId, objectType, patch, generation ->
                        queued.add(
                            obj(
                                "kind" to kind,
                                "objectId" to objectId,
                                "objectType" to objectType,
                                "patch" to patch,
                                "generation" to generation,
                            )
                        )
                    },
                    currentUserId = { "u1" },
                    nowProvider = { fakeNow },
                )

            // 1. Initial full fetch
            val item1 =
                obj(
                    "id" to "i1",
                    "tripId" to "t1",
                    "kind" to "boardItem",
                    "state" to "active",
                    "generation" to 0,
                    "payload" to
                        obj(
                            "boardId" to DEFAULT_BOARD_ID,
                            "frame" to obj("x" to 10, "y" to 20, "w" to 180, "h" to 140, "rotation" to 0, "scale" to 1),
                            "z" to 1,
                            "content" to obj("type" to "note", "text" to "initial"),
                            "style" to obj("color" to "yellow"),
                            "linkedActivityId" to null,
                            "createdBy" to "u1",
                        ),
                )
            server.enqueue(MockResponse().setBody(obj("items" to JSONArray(listOf(item1)), "cursor" to 5, "epoch" to 1).toString()))
            controller.openBoard("t1", DEFAULT_BOARD_ID)
            val firstReq = server.takeRequest()
            assertEquals("/api/trips/t1/boards/default-board/items", firstReq.path)
            assertEquals(1, controller.items.size)
            assertEquals(5L, controller.cursor)
            assertEquals(1L, controller.epoch)

            // 2. Optimistic patch keeps local x=200 when server echoes older copy within PENDING_TTL
            controller.patchBoardItem("i1", obj("frame" to obj("x" to 200)))
            assertEquals(1, queued.size)
            assertEquals("boardItem", queued.last().s("objectType"))
            assertEquals(200, queued.last().o("patch").o("frame").optInt("x"))
            assertEquals(180, queued.last().o("patch").o("frame").optInt("w"))

            // Stale response (same epoch=1, cursor=4 < 5) must be dropped completely
            server.enqueue(MockResponse().setBody(obj("items" to JSONArray(), "cursor" to 4, "epoch" to 1).toString()))
            controller.refreshActiveBoard()
            val secondReq = server.takeRequest()
            assertEquals("/api/trips/t1/boards/default-board/items?since=5", secondReq.path)
            assertEquals(5L, controller.cursor)
            assertEquals(200, controller.items.single().o("frame").optInt("x"))

            // Incremental fetch at cursor=6 still carries old x=10 -> pending protects x=200
            server.enqueue(MockResponse().setBody(obj("items" to JSONArray(listOf(item1)), "cursor" to 6, "epoch" to 1).toString()))
            controller.refreshActiveBoard()
            server.takeRequest()
            assertEquals(6L, controller.cursor)
            assertEquals(200, controller.items.single().o("frame").optInt("x"))

            // Incremental fetch at cursor=7 echoes x=200 and adds i2 -> merges & clears pending
            val item1Updated = item1.copyJson().apply { o("payload").o("frame").put("x", 200) }
            val item2 =
                obj(
                    "id" to "i2",
                    "tripId" to "t1",
                    "kind" to "boardItem",
                    "state" to "active",
                    "generation" to 0,
                    "payload" to
                        obj(
                            "boardId" to DEFAULT_BOARD_ID,
                            "frame" to obj("x" to 300, "y" to 50, "w" to 64, "h" to 64, "rotation" to 0, "scale" to 1),
                            "z" to 2,
                            "content" to obj("type" to "emoji", "char" to "🎉"),
                            "style" to obj(),
                            "linkedActivityId" to null,
                            "createdBy" to "u2",
                        ),
                )
            server.enqueue(
                MockResponse().setBody(obj("items" to JSONArray(listOf(item1Updated, item2)), "cursor" to 7, "epoch" to 1).toString())
            )
            controller.refreshActiveBoard()
            assertEquals("/api/trips/t1/boards/default-board/items?since=6", server.takeRequest().path)
            assertEquals(2, controller.items.size)
            assertEquals(7L, controller.cursor)

            // 3. Epoch change discards cursor and triggers full refetch without ?since=
            server.enqueue(MockResponse().setBody(obj("items" to JSONArray(), "cursor" to 2, "epoch" to 2).toString()))
            server.enqueue(MockResponse().setBody(obj("items" to JSONArray(listOf(item2)), "cursor" to 2, "epoch" to 2).toString()))
            controller.refreshActiveBoard()
            assertEquals("/api/trips/t1/boards/default-board/items?since=7", server.takeRequest().path)
            assertEquals("/api/trips/t1/boards/default-board/items", server.takeRequest().path)
            assertEquals(listOf("i2"), controller.items.map { it.s("id") })
            assertEquals(2L, controller.cursor)
            assertEquals(2L, controller.epoch)

            // 4. Persisted FileBoardCacheStore survives controller restart and offline open
            val restarted =
                BoardSyncController(
                    api = api,
                    cache = cache,
                    enqueueMutation = { _, _, _, _, _ -> },
                )
            server.shutdown()
            restarted.openBoard("t1", DEFAULT_BOARD_ID)
            assertEquals(listOf("i2"), restarted.items.map { it.s("id") })
            assertEquals(2L, restarted.cursor)
            assertEquals(2L, restarted.epoch)
            cacheDir.deleteRecursively()
        } finally {
            runCatching { server.shutdown() }
        }
        }
    }

    @Test
    fun deleteRestoreAndRejectionUpdateLocalState() {
        runBlocking {
        val server = MockWebServer()
        server.start()
        try {
            val api = JourneyApi(server.url("/").toString().trimEnd('/'), SessionCookies({ "[]" }, {}))
            val cache = MemoryBoardCacheStore()
            val queued = mutableListOf<JSONObject>()
            var fakeNow = 1000L
            val controller =
                BoardSyncController(
                    api = api,
                    cache = cache,
                    enqueueMutation = { kind, objectId, objectType, patch, generation ->
                        queued.add(
                            obj(
                                "kind" to kind,
                                "objectId" to objectId,
                                "objectType" to objectType,
                                "patch" to patch,
                                "generation" to generation,
                            )
                        )
                    },
                    currentUserId = { "u1" },
                    nowProvider = { fakeNow },
                )

            server.enqueue(MockResponse().setBody(obj("items" to JSONArray(), "cursor" to 1, "epoch" to 1).toString()))
            controller.openBoard("t1", DEFAULT_BOARD_ID)
            server.takeRequest()

            val created =
                controller.addBoardItem(
                    obj(
                        "content" to obj("type" to "note", "text" to "draft"),
                        "style" to obj("color" to "green"),
                        "frame" to obj("x" to 20, "y" to 30, "w" to 200, "h" to 140),
                    ),
                    id = "note-1",
                )
            assertEquals(1, controller.activeItems.size)
            assertEquals("note-1", created.s("id"))

            fakeNow = 2000L
            controller.deleteBoardItem("note-1")
            assertEquals(0, controller.activeItems.size)
            assertEquals(1, controller.deletedItems.size)
            assertEquals("delete", queued.last().s("kind"))
            assertEquals(0, queued.last().optInt("generation"))

            fakeNow = 3000L
            controller.restoreBoardItem("note-1")
            assertEquals(1, controller.activeItems.size)
            assertEquals("restore", queued.last().s("kind"))
            assertEquals(1, queued.last().optInt("generation"))

            controller.onOperationRejected(
                "t1",
                obj("objectId" to "note-1", "objectType" to "boardItem"),
                "BOARD_FULL",
                "每块白板最多添加 2000 个对象",
            )
            assertEquals("BOARD_FULL", controller.lastError?.code)
            assertEquals("每块白板最多添加 2000 个对象", controller.lastError?.message)
        } finally {
            server.shutdown()
        }
        }
    }
}
