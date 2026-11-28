package wang.jscloud.journey

import kotlin.math.abs
import org.json.JSONArray
import org.json.JSONObject

const val DEFAULT_BOARD_ID = "default-board"
const val DEFAULT_BOARD_TITLE = "主白板"
const val DEFAULT_BOARD_BACKGROUND = "dots"
const val MAX_BOARDS_PER_TRIP = 20
const val MAX_ITEMS_PER_BOARD = 2000
const val BOARD_PENDING_TTL_MS = 15_000L

val BOARD_STYLE_KEYS =
    listOf(
        "color",
        "size",
        "frameStyle",
        "variant",
        "fontSize",
        "tilt",
        "ratio",
        "autoWidth",
        "locked",
        "mapStyle",
    )

val BOARD_ITEM_PATCH_KEYS = listOf("frame", "z", "content", "style", "linkedActivityId")
val BOARD_BACKGROUNDS = setOf("dots", "grid", "plain")

fun activeBoards(objects: List<JSONObject>): List<JSONObject> =
    objects
        .filter { it.s("kind") == "board" && it.s("state") == "active" }
        .sortedWith(
            compareBy<JSONObject> {
                    (it.o("payload").opt("order") as? Number)?.toDouble() ?: 0.0
                }
                .thenBy { it.s("id") }
        )

fun deletedBoards(objects: List<JSONObject>): List<JSONObject> =
    objects.filter { it.s("kind") == "board" && it.s("state") == "deleted" }

fun resolveBoardId(snapshot: JSONObject?, preferredBoardId: String? = null): String {
    val boards = activeBoards(snapshot?.a("objects")?.rows().orEmpty())
    val preferred = preferredBoardId?.takeIf { it.isNotBlank() }
    val activeBoard =
        (preferred?.let { id -> boards.find { it.s("id") == id } }) ?: boards.firstOrNull()
    return activeBoard?.s("id")?.takeIf { it.isNotBlank() } ?: preferred ?: DEFAULT_BOARD_ID
}

fun nextBoardOrder(objects: List<JSONObject>): Double {
    val maxOrder =
        activeBoards(objects).maxOfOrNull {
            (it.o("payload").opt("order") as? Number)?.toDouble() ?: 0.0
        } ?: 0.0
    return maxOf(0.0, maxOrder) + 1.0
}

fun canCreateBoard(objects: List<JSONObject>): Boolean =
    activeBoards(objects).size < MAX_BOARDS_PER_TRIP

fun boardFullMessage(objectType: String?, serverMessage: String? = null): String =
    serverMessage?.takeIf { it.isNotBlank() }
        ?: if (objectType == "board") "每段旅程最多创建 20 块白板"
        else "每块白板最多添加 2000 个对象"

internal fun jsTruthy(value: Any?): Boolean =
    when (value) {
        null,
        JSONObject.NULL -> false
        is Boolean -> value
        is Number -> value.toDouble().let { it != 0.0 && !it.isNaN() }
        is String -> value.isNotEmpty()
        else -> true
    }

internal fun copyJsonValue(value: Any?): Any =
    when (value) {
        null,
        JSONObject.NULL -> JSONObject.NULL
        is JSONObject -> value.copyJson()
        is JSONArray -> JSONArray(value.toString())
        else -> value
    }

/** Drop style fields the board does not know before they reach the server (board.js). */
fun cleanBoardStylePatch(stylePatch: JSONObject?): JSONObject {
    val out = JSONObject()
    if (stylePatch == null) return out
    for (key in BOARD_STYLE_KEYS) {
        if (stylePatch.has(key)) {
            val value = stylePatch.get(key)
            out.put(key, if (key == "locked") jsTruthy(value) else copyJsonValue(value))
        }
    }
    return out
}

/**
 * Style an item gets from `patch` ({ style?, locked? }). Mirrors `nextBoardStyle` in board.js.
 */
fun nextBoardStyle(
    current: JSONObject?,
    patch: JSONObject?,
    replace: Boolean = false,
): JSONObject? {
    val patchObj = patch ?: JSONObject()
    val patchStyle = patchObj.optJSONObject("style")
    val hasLocked = patchObj.has("locked")
    if (patchStyle == null && !hasLocked) return null

    val out = JSONObject()
    if (!(replace && patchStyle != null) && current != null) {
        out.merge(current)
    }
    if (patchStyle != null) {
        out.merge(patchStyle)
    }
    if (hasLocked) {
        out.put("locked", jsTruthy(patchObj.get("locked")))
    }
    return out
}

fun defaultBoardFrame(): JSONObject =
    obj("x" to 0, "y" to 0, "w" to 100, "h" to 100, "rotation" to 0, "scale" to 1)

private fun normalizeBoardFrame(rawFrame: JSONObject): JSONObject =
    obj(
        "x" to (rawFrame.opt("x") ?: 0),
        "y" to (rawFrame.opt("y") ?: 0),
        "w" to (rawFrame.opt("w") ?: 100),
        "h" to (rawFrame.opt("h") ?: 100),
        "rotation" to
            (if (rawFrame.has("rotation") && !rawFrame.isNull("rotation")) rawFrame.get("rotation")
            else 0),
        "scale" to
            (if (rawFrame.has("scale") && !rawFrame.isNull("scale")) rawFrame.get("scale") else 1),
    )

/**
 * Normalize a boardItem so top-level fields and `payload` mirror each other, matching
 * `normalizeBoardItem` in `app/src/board-sync.js`. Unknown content/widget kinds stay intact.
 */
fun normalizeBoardItem(item: JSONObject): JSONObject {
    val p = item.optJSONObject("payload")
    val style =
        (item.optJSONObject("style") ?: p?.optJSONObject("style"))?.copyJson() ?: JSONObject()
    val locked =
        when {
            style.has("locked") && !style.isNull("locked") -> jsTruthy(style.get("locked"))
            item.has("locked") && !item.isNull("locked") -> jsTruthy(item.get("locked"))
            else -> false
        }
    val boardId =
        when {
            item.has("boardId") && !item.isNull("boardId") -> item.get("boardId")
            p != null && p.has("boardId") && !p.isNull("boardId") -> p.get("boardId")
            else -> null
        }
    val frame =
        (item.optJSONObject("frame") ?: p?.optJSONObject("frame"))?.copyJson()
            ?: defaultBoardFrame()
    val z =
        when {
            item.has("z") && !item.isNull("z") -> item.get("z")
            p != null && p.has("z") && !p.isNull("z") -> p.get("z")
            else -> 0
        }
    val content =
        (item.optJSONObject("content") ?: p?.optJSONObject("content"))?.copyJson() ?: JSONObject()
    val linkedActivityId: Any =
        when {
            item.has("linkedActivityId") -> copyJsonValue(item.get("linkedActivityId"))
            p != null && p.has("linkedActivityId") -> copyJsonValue(p.get("linkedActivityId"))
            else -> JSONObject.NULL
        }
    val createdBy =
        when {
            item.has("createdBy") && !item.isNull("createdBy") -> item.get("createdBy")
            p != null && p.has("createdBy") && !p.isNull("createdBy") -> p.get("createdBy")
            else -> null
        }

    val out = item.copyJson()
    if (boardId != null) out.put("boardId", boardId)
    out.put("frame", frame)
    out.put("z", z)
    out.put("content", content)
    out.put("style", style)
    out.put("locked", locked)
    out.put("linkedActivityId", linkedActivityId)
    if (createdBy != null) out.put("createdBy", createdBy)

    if (p != null) {
        val nextPayload = p.copyJson()
        if (boardId != null) nextPayload.put("boardId", boardId)
        nextPayload.put("frame", frame.copyJson())
        nextPayload.put("z", z)
        nextPayload.put("content", content.copyJson())
        nextPayload.put("style", style.copyJson())
        nextPayload.put("linkedActivityId", copyJsonValue(linkedActivityId))
        if (createdBy != null) nextPayload.put("createdBy", createdBy)
        out.put("payload", nextPayload)
    }
    return out
}

/**
 * Clean a boardItem patch so only allowed logical groups (`frame`, `z`, `content`, `style`,
 * `linkedActivityId`) and known style keys are sent. Mirrors `cleanBoardItemPatch` in
 * `app/src/board-sync.js`.
 */
fun cleanBoardItemPatch(rawPatch: JSONObject?): JSONObject {
    if (rawPatch == null) return JSONObject()
    val cleaned = JSONObject()
    val payloadObj = rawPatch.optJSONObject("payload")
    val source =
        if (payloadObj != null) {
            payloadObj.copyJson().apply { merge(rawPatch) }
        } else {
            rawPatch
        }

    var stylePatch = source.optJSONObject("style")?.copyJson()
    if (source.has("locked")) {
        stylePatch =
            (stylePatch ?: JSONObject()).apply {
                put("locked", jsTruthy(source.get("locked")))
            }
    }
    if (stylePatch != null) {
        cleaned.put("style", cleanBoardStylePatch(stylePatch))
    }

    for (k in BOARD_ITEM_PATCH_KEYS) {
        if (k == "style") continue
        if (source.has(k)) {
            cleaned.put(k, copyJsonValue(source.get(k)))
        }
    }

    cleaned.optJSONObject("frame")?.let { f ->
        cleaned.put("frame", normalizeBoardFrame(f))
    }
    return cleaned
}

fun buildBoardItemCreatePatch(boardId: String, itemData: JSONObject): JSONObject {
    val norm = normalizeBoardItem(itemData)
    val frame = normalizeBoardFrame(norm.optJSONObject("frame") ?: defaultBoardFrame())
    val style = cleanBoardStylePatch(norm.optJSONObject("style"))
    val content = norm.optJSONObject("content")?.copyJson() ?: JSONObject()
    val z = if (norm.has("z") && !norm.isNull("z")) norm.get("z") else 0
    val linkedActivityId =
        if (norm.has("linkedActivityId")) copyJsonValue(norm.get("linkedActivityId"))
        else JSONObject.NULL
    return obj(
        "boardId" to boardId,
        "content" to content,
        "style" to style,
        "frame" to frame,
        "z" to z,
        "linkedActivityId" to linkedActivityId,
    )
}

data class PendingBoardExpect(val expect: JSONObject, val at: Long)

private fun jsonDeepEqual(a: Any?, b: Any?): Boolean {
    val x = if (a == null || a === JSONObject.NULL) null else a
    val y = if (b == null || b === JSONObject.NULL) null else b
    if (x == null && y == null) return true
    if (x == null || y == null) return false
    return when {
        x is Number && y is Number -> x.toDouble() == y.toDouble()
        x is JSONObject && y is JSONObject -> {
            val xKeys = x.keys().asSequence().toSet()
            val yKeys = y.keys().asSequence().toSet()
            xKeys == yKeys && xKeys.all { k -> jsonDeepEqual(x.get(k), y.get(k)) }
        }
        x is JSONArray && y is JSONArray ->
            x.length() == y.length() && (0 until x.length()).all { i -> jsonDeepEqual(x.get(i), y.get(i)) }
        else -> x == y
    }
}

private fun sameBoardValue(a: Any?, b: Any?): Boolean {
    val x = if (a == null || a === JSONObject.NULL) null else a
    val y = if (b == null || b === JSONObject.NULL) null else b
    return if (x is Number && y is Number) {
        abs(x.toDouble() - y.toDouble()) < 0.01
    } else {
        jsonDeepEqual(x, y)
    }
}

private fun matchesExpected(item: JSONObject, expect: JSONObject): Boolean {
    val keys = expect.keys()
    while (keys.hasNext()) {
        val key = keys.next()
        val value = expect.get(key)
        if (value is JSONObject) {
            val subObj = item.optJSONObject(key)
            val subKeys = value.keys()
            while (subKeys.hasNext()) {
                val sub = subKeys.next()
                val actual = if (subObj != null && subObj.has(sub)) subObj.get(sub) else null
                if (!sameBoardValue(actual, value.get(sub))) return false
            }
        } else {
            val actual = if (item.has(key)) item.get(key) else null
            if (!sameBoardValue(actual, value)) return false
        }
    }
    return true
}

/** Merge nested expected object fields; mirrors `mergeExpected` in `app/src/board-pending.js`. */
fun mergeExpected(prev: JSONObject? = null, next: JSONObject? = null): JSONObject {
    val out = prev?.copyJson() ?: JSONObject()
    if (next == null) return out
    val keys = next.keys()
    while (keys.hasNext()) {
        val key = keys.next()
        val value = next.get(key)
        if (value is JSONObject) {
            val merged = (prev?.optJSONObject(key)?.copyJson() ?: JSONObject()).apply { merge(value) }
            out.put(key, merged)
        } else {
            out.put(key, copyJsonValue(value))
        }
    }
    return out
}

/**
 * Keep local versions of items whose pending change the server copy does not reflect yet.
 * Prunes `pending` in place once the server confirms a change or it expires past `BOARD_PENDING_TTL_MS`.
 * Mirrors `reconcilePending` in `app/src/board-pending.js`.
 */
fun reconcilePending(
    serverItems: List<JSONObject>,
    localItems: List<JSONObject>,
    pending: MutableMap<String, PendingBoardExpect>,
    now: Long = System.currentTimeMillis(),
): List<JSONObject> {
    if (pending.isEmpty()) return serverItems
    val local = localItems.associateBy { it.s("id") }
    val seen = mutableSetOf<String>()
    val out =
        serverItems.mapTo(mutableListOf()) { it ->
            val id = it.s("id")
            seen.add(id)
            val p = pending[id]
            if (p == null) {
                it
            } else if (matchesExpected(it, p.expect) || now - p.at > BOARD_PENDING_TTL_MS) {
                pending.remove(id)
                it
            } else {
                local[id] ?: it
            }
        }
    val iter = pending.entries.iterator()
    while (iter.hasNext()) {
        val (id, p) = iter.next()
        if (id in seen) continue
        if (now - p.at > BOARD_PENDING_TTL_MS) {
            iter.remove()
        } else {
            local[id]?.let { out.add(it) }
        }
    }
    return out
}

/**
 * Whether an items response is older than what is already on screen: same server epoch,
 * smaller cursor. Mirrors `isStaleResponse` in `app/src/board-pending.js`.
 */
fun isStaleResponse(res: JSONObject?, cursor: Long, epoch: Long?): Boolean {
    if (res == null || epoch == null || cursor == 0L) return false
    val resEpoch = (res.opt("epoch") as? Number)?.toLong() ?: return false
    val resCursor = (res.opt("cursor") as? Number)?.toLong() ?: 0L
    return resEpoch == epoch && resCursor < cursor
}
