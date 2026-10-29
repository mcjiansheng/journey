package wang.jscloud.journey

import java.math.BigDecimal
import java.math.RoundingMode
import java.util.Currency
import kotlin.math.*
import org.json.JSONArray
import org.json.JSONObject

fun obj(vararg pairs: Pair<String, Any?>): JSONObject =
    JSONObject().apply { pairs.forEach { (k, v) -> put(k, v ?: JSONObject.NULL) } }

fun JSONObject.s(k: String, default: String = "") =
    if (isNull(k)) default else optString(k, default)

fun JSONObject.o(k: String) = optJSONObject(k) ?: JSONObject()

fun JSONObject.a(k: String) = optJSONArray(k) ?: JSONArray()

fun JSONArray.rows(): List<JSONObject> = (0 until length()).mapNotNull { optJSONObject(it) }

fun JSONObject.copyJson() = JSONObject(toString())

fun JSONObject.merge(other: JSONObject) {
    other.keys().forEach { put(it, other.get(it)) }
}

fun planDayId(tripId: String, date: String?, ordinal: Int) =
    if (date != null) "plan-day-$tripId-date-$date" else "plan-day-$tripId-ordinal-$ordinal"

fun orderedActivities(objects: List<JSONObject>, dayId: String): List<JSONObject> {
    val rows =
        objects
            .filter {
                it.s("kind") == "activity" &&
                    it.s("state") == "active" &&
                    it.o("payload").s("dayId") == dayId
            }
            .sortedWith(
                compareBy<JSONObject> { it.o("payload").optDouble("order", 0.0) }
                    .thenBy { it.s("id") }
            )
    val precise =
        rows
            .filter {
                it.o("payload").o("time").s("mode") == "precise" &&
                    it.o("payload").o("time").s("start").isNotEmpty()
            }
            .sortedWith(
                compareBy<JSONObject> { it.o("payload").o("time").s("start") }.thenBy { it.s("id") }
            )
            .iterator()
    return rows.map {
        if (
            it.o("payload").o("time").s("mode") == "precise" &&
                it.o("payload").o("time").s("start").isNotEmpty()
        )
            precise.next()
        else it
    }
}

fun currencyScale(code: String) = Currency.getInstance(code).defaultFractionDigits.coerceAtLeast(0)

fun parseMinor(text: String, code: String): Long? {
    if (text.isBlank()) return null
    val amount = BigDecimal(text.trim())
    require(amount.signum() >= 0) { "金额不能小于零" }
    val minor =
        amount
            .movePointRight(currencyScale(code))
            .setScale(0, RoundingMode.UNNECESSARY)
            .longValueExact()
    require(minor <= 9007199254740991L) { "金额过大" }
    return minor
}

fun money(minor: Long, code: String) =
    BigDecimal.valueOf(minor, currencyScale(code)).toPlainString() + " " + code

fun timezoneForAdcode(code: String): String? {
    if (!Regex("[0-9]{6}").matches(code)) return null
    return when (code.take(2)) {
        "71" -> "Asia/Taipei"
        "81" -> "Asia/Hong_Kong"
        "82" -> "Asia/Macau"
        in setOf(
            "11",
            "12",
            "13",
            "14",
            "15",
            "21",
            "22",
            "23",
            "31",
            "32",
            "33",
            "34",
            "35",
            "36",
            "37",
            "41",
            "42",
            "43",
            "44",
            "45",
            "46",
            "50",
            "51",
            "52",
            "53",
            "54",
            "61",
            "62",
            "63",
            "64",
            "65",
        ) -> "Asia/Shanghai"
        else -> null
    }
}

object Coordinates {
    private fun outside(lng: Double, lat: Double) =
        lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271

    fun toGcj(lng: Double, lat: Double): Pair<Double, Double> {
        if (outside(lng, lat)) return lng to lat
        val x = lng - 105
        val y = lat - 35
        var dLat = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * sqrt(abs(x))
        dLat += (20 * sin(6 * x * PI) + 20 * sin(2 * x * PI)) * 2 / 3
        dLat += (20 * sin(y * PI) + 40 * sin(y / 3 * PI)) * 2 / 3
        dLat += (160 * sin(y / 12 * PI) + 320 * sin(y * PI / 30)) * 2 / 3
        var dLng = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * sqrt(abs(x))
        dLng += (20 * sin(6 * x * PI) + 20 * sin(2 * x * PI)) * 2 / 3
        dLng += (20 * sin(x * PI) + 40 * sin(x / 3 * PI)) * 2 / 3
        dLng += (150 * sin(x / 12 * PI) + 300 * sin(x / 30 * PI)) * 2 / 3
        val rad = lat / 180 * PI
        val magic = 1 - 0.006693421622965943 * sin(rad).pow(2)
        val root = sqrt(magic)
        dLat = dLat * 180 / ((6378245.0 * (1 - 0.006693421622965943)) / (magic * root) * PI)
        dLng = dLng * 180 / (6378245.0 / root * cos(rad) * PI)
        return lng + dLng to lat + dLat
    }

    fun toWgs(lng: Double, lat: Double): Pair<Double, Double> {
        if (outside(lng, lat)) return lng to lat
        var x = lng
        var y = lat
        repeat(8) {
            val p = toGcj(x, y)
            x -= p.first - lng
            y -= p.second - lat
        }
        return x to y
    }
}

/** Local projection only. The persisted operation and its original time never change. */
fun projectSnapshot(snapshot: JSONObject, queue: List<JSONObject>, userId: String): JSONObject {
    val next = snapshot.copyJson()
    val trip = next.o("trip")
    val id = trip.s("id")
    val rows = next.a("objects").rows().toMutableList()
    fun life(target: JSONObject, state: String) {
        if (target.s("state") != state) {
            target.put("state", state)
            target.put("generation", target.optInt("generation") + 1)
            if (state == "active")
                target.a("expressions").rows().forEach {
                    it.put("wishDelete", false)
                    it.put("wishRestore", false)
                }
        }
    }
    fun ensureDay(date: String?, ordinal: Int): JSONObject {
        val old =
            rows.find {
                it.s("kind") == "day" &&
                    if (date != null) it.o("payload").s("date") == date
                    else
                        it.o("payload").isNull("date") &&
                            it.o("payload").optInt("ordinal") == ordinal
            }
        if (old != null) return old
        return obj(
                "id" to planDayId(id, date, ordinal),
                "tripId" to id,
                "kind" to "day",
                "payload" to obj("date" to date, "ordinal" to ordinal),
                "state" to "active",
                "generation" to 0,
                "expressions" to JSONArray(),
            )
            .also { rows.add(it) }
    }
    queue
        .filter { it.s("tripId") == id }
        .forEach { queued ->
            val op = queued.o("operation")
            val target =
                if (op.s("objectId") == id) trip else rows.find { it.s("id") == op.s("objectId") }
            when (op.s("kind")) {
                "create" ->
                    if (target == null)
                        rows.add(
                            obj(
                                "id" to op.s("objectId"),
                                "tripId" to id,
                                "kind" to op.s("objectType"),
                                "payload" to op.o("patch").copyJson(),
                                "state" to "active",
                                "generation" to 0,
                                "expressions" to JSONArray(),
                            )
                        )
                "patch" ->
                    if (target != null) {
                        if (target === trip) target.merge(op.o("patch"))
                        else target.o("payload").merge(op.o("patch"))
                    }
                "delete",
                "restore" ->
                    if (target != null)
                        life(target, if (op.s("kind") == "delete") "deleted" else "active")
                "express" ->
                    if (target != null) {
                        val expressions = target.a("expressions").rows().toMutableList()
                        val own =
                            expressions.find { it.s("userId") == userId }
                                ?: obj(
                                        "userId" to userId,
                                        "notParticipating" to false,
                                        "wishDelete" to false,
                                        "wishRestore" to false,
                                    )
                                    .also { expressions.add(it) }
                        own.merge(op.o("expression"))
                        target.put("expressions", JSONArray(expressions))
                        val majority = next.a("members").length() / 2 + 1
                        if (
                            target.s("state") == "active" &&
                                trip.s("teamMode") == "equal" &&
                                expressions.any { it.optBoolean("wishDelete") } &&
                                expressions.count {
                                    it.optBoolean("wishDelete") ||
                                        (target.s("kind") == "activity" &&
                                            it.optBoolean("notParticipating"))
                                } >= majority
                        )
                            life(target, "deleted")
                        else if (
                            target.s("state") == "deleted" &&
                                expressions.count { it.optBoolean("wishRestore") } >= majority
                        )
                            life(target, "active")
                    }
                "reschedule" -> {
                    val p = op.o("patch")
                    val start =
                        p.s("startDate").ifBlank { null }?.let { java.time.LocalDate.parse(it) }
                    val count = p.optInt("dayCount")
                    for (ordinal in 1..count) ensureDay(
                        start?.plusDays(ordinal.toLong() - 1)?.toString(),
                        ordinal,
                    )
                    p.a("moves").rows().forEach { m ->
                        val activity = rows.find { it.s("id") == m.s("activityId") }
                        val ordinal = m.optInt("ordinal", 1)
                        val day =
                            if (m.s("dayId").isNotBlank()) rows.find { it.s("id") == m.s("dayId") }
                            else
                                ensureDay(
                                    m.s("date").ifBlank {
                                        start?.plusDays(ordinal.toLong() - 1)?.toString()
                                    },
                                    ordinal,
                                )
                        if (day?.s("state") == "active")
                            activity?.o("payload")?.put("dayId", day.s("id"))
                    }
                    trip.put("startDate", start?.toString() ?: JSONObject.NULL)
                    trip.put("dayCount", count)
                }
            }
        }
    next.put("objects", JSONArray(rows))
    return next
}

fun normalizeInvite(value: String): String {
    val text = value.trim()
    if (!text.contains("://")) return text
    val uri = java.net.URI(text)
    val query =
        uri.rawQuery
            .orEmpty()
            .split('&')
            .firstOrNull { it.substringBefore('=') == "invite" }
            ?.substringAfter('=')
    return if (query != null) java.net.URLDecoder.decode(query, "UTF-8")
    else uri.path.substringAfterLast('/')
}

fun endpointSignature(from: JSONObject, to: JSONObject): String {
    fun place(row: JSONObject): Any {
        val p = row.o("payload").optJSONObject("place") ?: row
        return JSONArray(
            listOf(
                p.s("providerPlaceId"),
                p.opt("lng") ?: JSONObject.NULL,
                p.opt("lat") ?: JSONObject.NULL,
                p.s("address"),
                p.s("name"),
            )
        )
    }
    return canonicalJson(JSONArray(listOf(from.s("id"), place(from), to.s("id"), place(to))))
}

fun routeSignature(from: JSONObject, to: JSONObject, mode: String) =
    canonicalJson(JSONArray(listOf(endpointSignature(from, to), mode)))

// Android's JSON writer escapes slashes. The shared route signature uses JSON.stringify.
private fun canonicalJson(value: Any?): String =
    when (value) {
        null,
        JSONObject.NULL -> "null"
        is JSONArray ->
            (0 until value.length()).joinToString(",", "[", "]") { canonicalJson(value.opt(it)) }
        is String ->
            buildString {
                append('"')
                value.forEach { c ->
                    when (c) {
                        '"' -> append("\\\"")
                        '\\' -> append("\\\\")
                        '\b' -> append("\\b")
                        '\u000c' -> append("\\f")
                        '\n' -> append("\\n")
                        '\r' -> append("\\r")
                        '\t' -> append("\\t")
                        else ->
                            if (c.code < 32) append("\\u" + c.code.toString(16).padStart(4, '0'))
                            else append(c)
                    }
                }
                append('"')
            }
        is Number -> {
            val d = value.toDouble()
            if (d == 0.0) "0"
            else {
                val decimal = BigDecimal.valueOf(d).stripTrailingZeros()
                if (kotlin.math.abs(d) >= 0.000001 && kotlin.math.abs(d) < 1e21)
                    decimal.toPlainString()
                else
                    decimal
                        .toString()
                        .replace("E-0", "e-")
                        .replace("E+0", "e+")
                        .replace("E", "e")
                        .let {
                            if (!it.contains("e-") && !it.contains("e+") && it.contains("e"))
                                it.replace("e", "e+")
                            else it
                        }
            }
        }
        else -> value.toString()
    }
