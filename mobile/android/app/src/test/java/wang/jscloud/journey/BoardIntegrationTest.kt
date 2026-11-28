package wang.jscloud.journey

import java.util.UUID
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test

/**
 * Live integration test against dev-server / Journey backend for Work Package B1.
 * Configured via JOURNEY_TEST_BASE_URL, JOURNEY_TEST_IDENTIFIER, JOURNEY_TEST_PASSWORD,
 * JOURNEY_TEST_TRIP_ID, plus optional JOURNEY_TEST_WEB_NOTE_TEXT & JOURNEY_TEST_ANDROID_NOTE_TEXT.
 */
class BoardIntegrationTest {
    private fun env(): Map<String, String>? {
        val url = System.getenv("JOURNEY_TEST_BASE_URL")
        val identifier = System.getenv("JOURNEY_TEST_IDENTIFIER")
        val password = System.getenv("JOURNEY_TEST_PASSWORD")
        val trip = System.getenv("JOURNEY_TEST_TRIP_ID")
        val all = listOf(url, identifier, password, trip)
        if (all.any { it.isNullOrBlank() }) return null
        return mapOf(
            "url" to url!!,
            "identifier" to identifier!!,
            "password" to password!!,
            "trip" to trip!!,
        )
    }

    private fun loginAndClock(cfg: Map<String, String>): Triple<JourneyApi, String, String> {
        var cookies = "[]"
        val api = JourneyApi(cfg["url"]!!, SessionCookies({ cookies }, { cookies = it }))
        val session =
            api.request(
                "/api/auth/login",
                "POST",
                obj("identifier" to cfg["identifier"], "password" to cfg["password"]),
            )
        api.csrf = session.s("csrfToken")
        val userId = session.o("user").s("id")
        val clock =
            api.request(
                "/api/clock",
                "POST",
                obj("deviceId" to "android-b1-${UUID.randomUUID()}"),
            )
        return Triple(api, userId, clock.s("leaseId"))
    }

    private fun makeClock(leaseId: String, startNanos: Long) =
        obj(
            "leaseId" to leaseId,
            "elapsedMs" to ((System.nanoTime() - startNanos) / 1_000_000L).coerceAtLeast(0L),
            "uncertaintyMs" to 100,
        )

    @Test
    fun realBackendBoardSyncAndInteropRoundTrip() {
        runBlocking {
        val cfg = env()
        assumeTrue("Live fixture env vars required", cfg != null)
        val tripId = cfg!!["trip"]!!
        val (api, userId, leaseId) = loginAndClock(cfg)
        val startNanos = System.nanoTime()

        // 1. Lazy default-board items fetch & normalization (also verifies Web-created note if provided)
        val queue = mutableListOf<JSONObject>()
        val cache = MemoryBoardCacheStore()
        val controller =
            BoardSyncController(
                api = api,
                cache = cache,
                enqueueMutation = { kind, objectId, objectType, patch, generation ->
                    queue.add(
                        obj(
                            "id" to UUID.randomUUID().toString(),
                            "objectId" to objectId,
                            "kind" to kind,
                            "objectType" to objectType,
                            "patch" to patch,
                            "generation" to generation,
                            "clock" to makeClock(leaseId, startNanos),
                        )
                    )
                },
                currentUserId = { userId },
            )

        controller.openBoard(tripId, DEFAULT_BOARD_ID)
        assertTrue((controller.epoch ?: 0L) > 0L)

        val expectedWebNote = System.getenv("JOURNEY_TEST_WEB_NOTE_TEXT")?.takeIf { it.isNotBlank() }
        if (expectedWebNote != null) {
            val webNote =
                controller.activeItems.find {
                    it.o("content").s("type") == "note" && it.o("content").s("text") == expectedWebNote
                }
            assertNotNull("Expected web-created note '$expectedWebNote' on default-board", webNote)
            assertTrue(webNote!!.o("style").s("color").isNotBlank())
        }

        // 2. Offline queue -> ordered replay for create + 5 logic-group patches
        val androidNoteText =
            System.getenv("JOURNEY_TEST_ANDROID_NOTE_TEXT")?.ifBlank { null }
                ?: "Android B1 同步便签"
        val noteId = "android-note-${UUID.randomUUID().toString().replace("-", "").take(12)}"
        controller.addBoardItem(
            obj(
                "content" to obj("type" to "note", "text" to androidNoteText),
                "style" to obj("color" to "green"),
                "frame" to obj("x" to 420, "y" to 180, "w" to 220, "h" to 160),
                "z" to 5,
            ),
            id = noteId,
        )
        controller.patchBoardItem(
            noteId,
            obj(
                "frame" to obj("x" to 460, "y" to 200, "w" to 240, "h" to 170),
                "z" to 9,
                "style" to obj("color" to "blue", "variant" to "lined", "junkKey" to "shouldDrop"),
                "locked" to true,
            ),
        )
        val emojiId = "android-emoji-${UUID.randomUUID().toString().replace("-", "").take(12)}"
        controller.addBoardItem(
            obj(
                "content" to obj("type" to "emoji", "char" to "✈️"),
                "style" to obj(),
                "frame" to obj("x" to 720, "y" to 190, "w" to 72, "h" to 72),
                "z" to 10,
            ),
            id = emojiId,
        )

        // Replay queued boardItem ops and verify server omits `snapshot` and sets `receipt.operationId`
        assertEquals(3, queue.size)
        for (op in queue) {
            val payload =
                op.copyJson().apply {
                    if (isNull("patch")) remove("patch")
                    if (isNull("generation")) remove("generation")
                }
            val res = api.request("/api/trips/$tripId/operations", "POST", payload)
            assertFalse("boardItem operation response must omit snapshot", res.has("snapshot"))
            assertEquals(op.s("id"), res.o("receipt").s("operationId"))
            assertTrue(res.o("receipt").optBoolean("changed"))
        }
        queue.clear()

        // Incremental refresh (?since=) picks up the exact synced state
        val prevCursor = controller.cursor
        controller.refreshActiveBoard()
        assertTrue(controller.cursor >= prevCursor)
        val syncedNote = controller.activeItems.find { it.s("id") == noteId }!!
        assertEquals(460, syncedNote.o("frame").optInt("x"))
        assertEquals(9, syncedNote.optInt("z"))
        assertEquals("blue", syncedNote.o("style").s("color"))
        assertEquals("lined", syncedNote.o("style").s("variant"))
        assertTrue(syncedNote.optBoolean("locked"))
        assertFalse(syncedNote.o("style").has("junkKey"))

        // 3. Stale-generation delete / restore -> receipt.changed == false (HTTP 200)
        val tempId = "android-tmp-${UUID.randomUUID().toString().replace("-", "").take(12)}"
        controller.addBoardItem(
            obj(
                "content" to obj("type" to "note", "text" to "temp delete test"),
                "style" to obj("color" to "yellow"),
                "frame" to obj("x" to 100, "y" to 380, "w" to 180, "h" to 120),
                "z" to 1,
            ),
            id = tempId,
        )
        val createTmp =
            queue.removeAt(0).apply {
                if (isNull("patch")) remove("patch")
                if (isNull("generation")) remove("generation")
            }
        api.request("/api/trips/$tripId/operations", "POST", createTmp)
        controller.refreshActiveBoard()

        val delRes1 =
            api.request(
                "/api/trips/$tripId/operations",
                "POST",
                obj(
                    "id" to UUID.randomUUID().toString(),
                    "objectId" to tempId,
                    "kind" to "delete",
                    "objectType" to "boardItem",
                    "generation" to 0,
                    "clock" to makeClock(leaseId, startNanos),
                ),
            )
        assertTrue(delRes1.o("receipt").optBoolean("changed"))
        assertFalse(delRes1.has("snapshot"))

        // Second delete with stale generation=0: server returns 200 with receipt.changed == false
        val delResStale =
            api.request(
                "/api/trips/$tripId/operations",
                "POST",
                obj(
                    "id" to UUID.randomUUID().toString(),
                    "objectId" to tempId,
                    "kind" to "delete",
                    "objectType" to "boardItem",
                    "generation" to 0,
                    "clock" to makeClock(leaseId, startNanos),
                ),
            )
        assertFalse(delResStale.o("receipt").optBoolean("changed"))
        assertFalse(delResStale.has("snapshot"))

        // Restore with generation=1, then stale restore with generation=1 -> changed == false
        val restRes1 =
            api.request(
                "/api/trips/$tripId/operations",
                "POST",
                obj(
                    "id" to UUID.randomUUID().toString(),
                    "objectId" to tempId,
                    "kind" to "restore",
                    "objectType" to "boardItem",
                    "generation" to 1,
                    "clock" to makeClock(leaseId, startNanos),
                ),
            )
        assertTrue(restRes1.o("receipt").optBoolean("changed"))

        val restResStale =
            api.request(
                "/api/trips/$tripId/operations",
                "POST",
                obj(
                    "id" to UUID.randomUUID().toString(),
                    "objectId" to tempId,
                    "kind" to "restore",
                    "objectType" to "boardItem",
                    "generation" to 1,
                    "clock" to makeClock(leaseId, startNanos),
                ),
            )
        assertFalse(restResStale.o("receipt").optBoolean("changed"))

        // Clean up temporary item
        api.request(
            "/api/trips/$tripId/operations",
            "POST",
            obj(
                "id" to UUID.randomUUID().toString(),
                "objectId" to tempId,
                "kind" to "delete",
                "objectType" to "boardItem",
                "generation" to 2,
                "clock" to makeClock(leaseId, startNanos),
            ),
        )
        }
    }

    @Test
    fun realBackendBoardLimitReturnsBoardFull409() {
        val cfg = env()
        assumeTrue("Live fixture env vars required", cfg != null)
        val (api, _, leaseId) = loginAndClock(cfg!!)
        val startNanos = System.nanoTime()

        val tempTrip =
            api.request(
                "/api/trips",
                "POST",
                obj(
                    "id" to UUID.randomUUID().toString(),
                    "name" to "B1容量验证",
                    "destination" to "南京",
                    "teamMode" to "equal",
                    "timezone" to "Asia/Shanghai",
                    "currency" to "CNY",
                    "startDate" to "2026-11-07",
                    "dayCount" to 1,
                ),
            )
        val tempTripId = tempTrip.o("trip").s("id")
        val initialBoards = activeBoards(tempTrip.a("objects").rows()).size
        try {
            // Creating up to MAX_BOARDS_PER_TRIP active boards succeeds; the next must return 409 BOARD_FULL
            for (i in 1..(MAX_BOARDS_PER_TRIP - initialBoards)) {
                val res =
                    api.request(
                        "/api/trips/$tempTripId/operations",
                        "POST",
                        obj(
                            "id" to UUID.randomUUID().toString(),
                            "objectId" to "board-$i",
                            "kind" to "create",
                            "objectType" to "board",
                            "patch" to obj("title" to "白板 $i", "order" to i, "background" to "dots"),
                            "clock" to makeClock(leaseId, startNanos),
                        ),
                    )
                assertTrue(res.o("receipt").optBoolean("changed"))
            }
            try {
                api.request(
                    "/api/trips/$tempTripId/operations",
                    "POST",
                    obj(
                        "id" to UUID.randomUUID().toString(),
                        "objectId" to "board-21",
                        "kind" to "create",
                        "objectType" to "board",
                        "patch" to obj("title" to "白板 21", "order" to 21, "background" to "dots"),
                        "clock" to makeClock(leaseId, startNanos),
                    ),
                )
                fail("Expected 409 BOARD_FULL when creating 21st board")
            } catch (e: ApiFailure) {
                assertEquals(409, e.status)
                assertEquals("BOARD_FULL", e.code)
                assertTrue(boardFullMessage("board", e.message).contains("20"))
            }
        } finally {
            runCatching {
                api.request(
                    "/api/trips/$tempTripId/leave",
                    "POST",
                    obj("confirmPurge" to true),
                )
            }
        }
    }
}
