package wang.jscloud.journey

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import java.io.File
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.util.UUID
import org.json.JSONArray
import org.json.JSONObject

interface BoardItemsApi {
    fun fetchBoardItems(tripId: String, boardId: String, since: Long? = null): JSONObject
}

data class BoardCacheEntry(
    val cursor: Long,
    val epoch: Long?,
    val items: List<JSONObject>,
)

interface BoardCacheStore {
    fun read(tripId: String, boardId: String): BoardCacheEntry?
    fun write(tripId: String, boardId: String, entry: BoardCacheEntry)
    fun clearTrip(tripId: String)
}

class MemoryBoardCacheStore : BoardCacheStore {
    private val map = mutableMapOf<String, BoardCacheEntry>()

    @Synchronized
    override fun read(tripId: String, boardId: String): BoardCacheEntry? {
        val cached = map["$tripId:$boardId"] ?: return null
        return cached.copy(items = cached.items.map(::normalizeBoardItem))
    }

    @Synchronized
    override fun write(tripId: String, boardId: String, entry: BoardCacheEntry) {
        map["$tripId:$boardId"] = entry.copy(items = entry.items.map { it.copyJson() })
    }

    @Synchronized
    override fun clearTrip(tripId: String) {
        val prefix = "$tripId:"
        map.keys.removeAll { it.startsWith(prefix) }
    }
}

class FileBoardCacheStore(private val rootDirProvider: () -> File) : BoardCacheStore {
    private fun safeSegment(value: String): String =
        value.replace(Regex("[^A-Za-z0-9_-]"), "_")

    private fun tripDir(tripId: String): File =
        File(rootDirProvider(), safeSegment(tripId))

    private fun boardFile(tripId: String, boardId: String): File {
        val dir = tripDir(tripId).apply { mkdirs() }
        return File(dir, "${safeSegment(boardId)}.json")
    }

    @Synchronized
    override fun read(tripId: String, boardId: String): BoardCacheEntry? {
        val file = boardFile(tripId, boardId)
        if (!file.exists()) return null
        return runCatching {
            val json = JSONObject(file.readText())
            val cursor = (json.opt("cursor") as? Number)?.toLong() ?: 0L
            val epoch = (json.opt("epoch") as? Number)?.toLong()
            val items = json.a("items").rows().map(::normalizeBoardItem)
            BoardCacheEntry(cursor = cursor, epoch = epoch, items = items)
        }.getOrNull()
    }

    @Synchronized
    override fun write(tripId: String, boardId: String, entry: BoardCacheEntry) {
        runCatching {
            val file = boardFile(tripId, boardId)
            val tmp = File(file.parentFile, "${file.name}.tmp")
            val payload =
                obj(
                    "cursor" to entry.cursor,
                    "epoch" to entry.epoch,
                    "items" to JSONArray(entry.items),
                )
            tmp.writeText(payload.toString())
            try {
                Files.move(
                    tmp.toPath(),
                    file.toPath(),
                    StandardCopyOption.REPLACE_EXISTING,
                    StandardCopyOption.ATOMIC_MOVE,
                )
            } catch (_: AtomicMoveNotSupportedException) {
                Files.move(tmp.toPath(), file.toPath(), StandardCopyOption.REPLACE_EXISTING)
            }
        }
    }

    @Synchronized
    override fun clearTrip(tripId: String) {
        runCatching { tripDir(tripId).deleteRecursively() }
    }
}

/**
 * Board item cache, incremental sync (`?since=` + `epoch` reset), optimistic mutations,
 * and pending-expect reconciliation. Mirrors `useBoard` in `app/src/board-sync.js`.
 */
class BoardSyncController(
    private val api: BoardItemsApi,
    private val cache: BoardCacheStore,
    private val enqueueMutation:
        suspend (
            kind: String,
            objectId: String,
            objectType: String,
            patch: JSONObject?,
            generation: Int?,
        ) -> Unit,
    private val currentUserId: () -> String = { "" },
    private val nowProvider: () -> Long = { System.currentTimeMillis() },
) {
    var activeTripId by mutableStateOf<String?>(null)
        private set

    var activeBoardId by mutableStateOf<String?>(null)
        private set

    var items by mutableStateOf<List<JSONObject>>(emptyList())
        private set

    var cursor by mutableLongStateOf(0L)
        private set

    var epoch by mutableStateOf<Long?>(null)
        private set

    var loading by mutableStateOf(false)
        private set

    var lastError by mutableStateOf<ApiFailure?>(null)

    val activeItems: List<JSONObject>
        get() = items.filter { it.s("state") != "deleted" }

    val deletedItems: List<JSONObject>
        get() =
            items
                .filter { it.s("state") == "deleted" }
                .sortedByDescending { (it.opt("updatedAt") as? Number)?.toLong() ?: 0L }

    private val pendingExpect = mutableMapOf<String, PendingBoardExpect>()

    fun hasItem(itemId: String): Boolean = items.any { it.s("id") == itemId }

    fun resetActiveBoard() {
        activeTripId = null
        activeBoardId = null
        items = emptyList()
        cursor = 0L
        epoch = null
        loading = false
        lastError = null
        pendingExpect.clear()
    }

    fun clearTripCache(tripId: String) {
        if (activeTripId == tripId) {
            resetActiveBoard()
        }
        cache.clearTrip(tripId)
    }

    private fun expectLocal(itemId: String, expect: JSONObject) {
        val prev = pendingExpect[itemId]
        pendingExpect[itemId] =
            PendingBoardExpect(
                expect = mergeExpected(prev?.expect, expect),
                at = nowProvider(),
            )
    }

    suspend fun openBoard(tripId: String, boardId: String) {
        if (activeTripId != tripId || activeBoardId != boardId) {
            activeTripId = tripId
            activeBoardId = boardId
            items = emptyList()
            cursor = 0L
            epoch = null
            pendingExpect.clear()
        }
        lastError = null
        loading = true

        val cached = cache.read(tripId, boardId)
        if (cached != null) {
            items = cached.items
            cursor = cached.cursor
            epoch = cached.epoch
        }

        try {
            refreshActiveBoard(forceFull = false)
        } catch (e: ApiFailure) {
            if (e.code != "NETWORK") {
                lastError = e
                throw e
            }
        } finally {
            loading = false
        }
    }

    suspend fun refreshActiveBoard(forceFull: Boolean = false) {
        val targetTripId = activeTripId ?: return
        val targetBoardId = activeBoardId ?: return

        val currentCursor = if (forceFull) 0L else cursor
        val currentEpoch = epoch
        val since = if (currentCursor > 0L) currentCursor else null

        var res = api.fetchBoardItems(targetTripId, targetBoardId, since)
        if (activeTripId != targetTripId || activeBoardId != targetBoardId) return

        if (!forceFull && isStaleResponse(res, currentCursor, currentEpoch)) {
            return
        }

        val initialEpoch = (res.opt("epoch") as? Number)?.toLong()
        var replace = since == null
        if (since != null && (currentEpoch == null || initialEpoch != currentEpoch)) {
            // Server epoch changed (restart/restore): discard cursor and refetch complete board.
            res = api.fetchBoardItems(targetTripId, targetBoardId, null)
            if (activeTripId != targetTripId || activeBoardId != targetBoardId) return
            replace = true
        }

        val serverItems = res.a("items").rows().map(::normalizeBoardItem)
        val fromServer =
            if (replace) {
                serverItems
            } else {
                val map = LinkedHashMap<String, JSONObject>()
                for (existing in items) {
                    val norm = normalizeBoardItem(existing)
                    map[norm.s("id")] = norm
                }
                for (incoming in serverItems) {
                    map[incoming.s("id")] = incoming
                }
                map.values.toList()
            }

        val merged = reconcilePending(fromServer, items, pendingExpect, nowProvider())
        val nextCursor = (res.opt("cursor") as? Number)?.toLong() ?: 0L
        val nextEpoch = (res.opt("epoch") as? Number)?.toLong() ?: 0L

        items = merged
        cursor = nextCursor
        epoch = nextEpoch
        lastError = null
        cache.write(
            targetTripId,
            targetBoardId,
            BoardCacheEntry(cursor = nextCursor, epoch = nextEpoch, items = merged),
        )
    }

    suspend fun addBoardItem(
        itemData: JSONObject,
        id: String = itemData.s("id").ifBlank { UUID.randomUUID().toString() },
    ): JSONObject {
        val tripId = activeTripId ?: throw IllegalStateException("请先打开白板")
        val boardId = activeBoardId ?: throw IllegalStateException("请先打开白板")
        val now = nowProvider()

        val raw =
            itemData.copyJson().apply {
                put("id", id)
                put("tripId", tripId)
                put("boardId", boardId)
                if (!has("createdBy") || isNull("createdBy")) {
                    put("createdBy", currentUserId())
                }
                if (!has("createdAt")) put("createdAt", now)
                if (!has("updatedAt")) put("updatedAt", now)
                if (!has("state")) put("state", "active")
                if (!has("generation")) put("generation", 0)
            }
        val newItem = normalizeBoardItem(raw)
        val createPatch = buildBoardItemCreatePatch(boardId, newItem)

        expectLocal(id, obj("state" to "active"))
        val nextItems = items + newItem
        items = nextItems
        cache.write(tripId, boardId, BoardCacheEntry(cursor = cursor, epoch = epoch, items = nextItems))

        enqueueMutation("create", id, "boardItem", createPatch, null)
        return newItem
    }

    suspend fun patchBoardItem(
        itemId: String,
        patch: JSONObject,
        replaceStyle: Boolean = false,
    ): JSONObject? {
        val tripId = activeTripId ?: throw IllegalStateException("请先打开白板")
        val boardId = activeBoardId ?: throw IllegalStateException("请先打开白板")
        val target = items.find { it.s("id") == itemId } ?: return null
        val now = nowProvider()

        val styleWithLock =
            nextBoardStyle(
                target.optJSONObject("style"),
                patch,
                replace = replaceStyle && patch.optJSONObject("style") != null,
            )
        val patchToClean =
            patch.copyJson().apply {
                if (styleWithLock != null) put("style", styleWithLock)
            }
        // Complete partial frame/content patches with target values so each changed logic group is whole.
        patchToClean.optJSONObject("frame")?.let { f ->
            val mergedFrame = (target.optJSONObject("frame")?.copyJson() ?: defaultBoardFrame()).apply {
                merge(f)
            }
            patchToClean.put("frame", mergedFrame)
        }
        patchToClean.optJSONObject("content")?.let { c ->
            val mergedContent = (target.optJSONObject("content")?.copyJson() ?: JSONObject()).apply {
                merge(c)
            }
            patchToClean.put("content", mergedContent)
        }

        val cleaned = cleanBoardItemPatch(patchToClean)
        val updatedRaw =
            target.copyJson().apply {
                merge(cleaned)
                if (cleaned.has("content")) {
                    put(
                        "content",
                        (target.optJSONObject("content")?.copyJson() ?: JSONObject()).apply {
                            merge(cleaned.o("content"))
                        },
                    )
                }
                if (cleaned.has("style")) {
                    val replace = replaceStyle && patch.optJSONObject("style") != null
                    put(
                        "style",
                        if (replace) cleaned.o("style").copyJson()
                        else
                            (target.optJSONObject("style")?.copyJson() ?: JSONObject()).apply {
                                merge(cleaned.o("style"))
                            },
                    )
                }
                if (cleaned.has("frame")) {
                    put(
                        "frame",
                        (target.optJSONObject("frame")?.copyJson() ?: defaultBoardFrame()).apply {
                            merge(cleaned.o("frame"))
                        },
                    )
                }
                put("updatedAt", now)
            }
        val updatedItem = normalizeBoardItem(updatedRaw)

        expectLocal(itemId, cleaned)
        val nextItems = items.map { if (it.s("id") == itemId) updatedItem else it }
        items = nextItems
        cache.write(tripId, boardId, BoardCacheEntry(cursor = cursor, epoch = epoch, items = nextItems))

        enqueueMutation("patch", itemId, "boardItem", cleaned, null)
        return updatedItem
    }

    suspend fun deleteBoardItem(itemId: String) {
        changeItemLifecycle(itemId, targetState = "deleted", opKind = "delete")
    }

    suspend fun restoreBoardItem(itemId: String) {
        changeItemLifecycle(itemId, targetState = "active", opKind = "restore")
    }

    private suspend fun changeItemLifecycle(itemId: String, targetState: String, opKind: String) {
        val tripId = activeTripId ?: throw IllegalStateException("请先打开白板")
        val boardId = activeBoardId ?: throw IllegalStateException("请先打开白板")
        val target = items.find { it.s("id") == itemId } ?: return
        val now = nowProvider()

        expectLocal(itemId, obj("state" to targetState))
        val nextItems =
            items.map { it ->
                if (it.s("id") == itemId) {
                    normalizeBoardItem(
                        it.copyJson().apply {
                            put("state", targetState)
                            put("generation", it.optInt("generation", 0) + 1)
                            put("updatedAt", now)
                        }
                    )
                } else {
                    it
                }
            }
        items = nextItems
        cache.write(tripId, boardId, BoardCacheEntry(cursor = cursor, epoch = epoch, items = nextItems))

        enqueueMutation(opKind, itemId, "boardItem", null, target.optInt("generation", 0))
    }

    fun onOperationRejected(tripId: String, op: JSONObject, code: String, message: String) {
        lastError = ApiFailure(code, message, if (code == "BOARD_FULL") 409 else 0)
        if (activeTripId == tripId) {
            pendingExpect.remove(op.s("objectId"))
        }
    }
}
