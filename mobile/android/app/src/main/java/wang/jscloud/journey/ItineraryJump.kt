package wang.jscloud.journey

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowDownward
import androidx.compose.material.icons.outlined.MyLocation
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import java.time.Instant
import java.time.ZoneId
import org.json.JSONObject

data class TripClock(val today: String, val clock: String)

/**
 * Computes today's date (`YYYY-MM-DD`) and 24-hour clock (`HH:mm`) in the trip's destination
 * timezone rather than the device timezone, matching `Itinerary.jsx`.
 */
fun tripClockAt(timezone: String, nowMillis: Long): TripClock {
    val zone =
        runCatching {
            val trimmed = timezone.trim()
            if (trimmed.isEmpty()) ZoneId.systemDefault() else ZoneId.of(trimmed)
        }.getOrElse { ZoneId.systemDefault() }
    val zoned = Instant.ofEpochMilli(nowMillis).atZone(zone)
    return TripClock(
        today = zoned.toLocalDate().toString(),
        clock = "%02d:%02d".format(zoned.hour, zoned.minute),
    )
}

fun findTodayDay(days: List<JSONObject>, today: String): JSONObject? =
    days.firstOrNull { it.o("payload").s("date") == today }

/**
 * Returns the first precise-time activity on today's plan day that has not ended yet (`endDayOffset > 0`
 * or `(end || start) >= clock`), matching `nextActivity` in `Itinerary.jsx`.
 */
fun findNextActivity(
    currentDay: JSONObject?,
    orderedRows: List<JSONObject>,
    today: String,
    clock: String,
): JSONObject? {
    if (currentDay == null || currentDay.o("payload").s("date") != today) return null
    return orderedRows.firstOrNull { o ->
        val time = o.o("payload").o("time")
        if (time.s("mode") != "precise") return@firstOrNull false
        val endOrStart = time.s("end").ifBlank { time.s("start") }
        time.optInt("endDayOffset") > 0 || (endOrStart.isNotEmpty() && endOrStart >= clock)
    }
}

fun canDeleteDirectly(trip: JSONObject, members: List<JSONObject>, userId: String?): Boolean {
    if (userId.isNullOrBlank()) return false
    if (trip.s("ownerId") == userId) return true
    if (trip.s("teamMode") != "admin") return false
    return members.any { it.s("userId") == userId && it.optBoolean("isAdmin") }
}

fun deletedObjectTitle(o: JSONObject, objects: List<JSONObject>): String {
    val p = o.o("payload")
    return when (o.s("kind")) {
        "day" -> p.s("date").ifBlank { "第 ${p.optInt("ordinal")} 天" }
        "route" -> {
            val from =
                if (p.s("fromId").isNotBlank())
                    objects.find { it.s("id") == p.s("fromId") }?.o("payload")?.s("title").orEmpty()
                else p.o("fromPlace").s("name")
            val to = objects.find { it.s("id") == p.s("toId") }?.o("payload")?.s("title").orEmpty()
            "${from.ifBlank { "出发地" }} → ${to.ifBlank { "目的地" }}"
        }
        else -> p.s("title").ifBlank { p.s("name").ifBlank { "计划内容" } }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ItineraryJumpBar(
    todayDay: JSONObject?,
    currentDayId: String?,
    nextActivity: JSONObject?,
    onJumpToday: (String) -> Unit,
    onJumpNext: (String) -> Unit,
) {
    val showToday = todayDay != null && todayDay.s("id") != currentDayId
    if (!showToday && nextActivity == null) return
    FlowRow(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (showToday && todayDay != null) {
            SecondaryButton(onClick = { onJumpToday(todayDay.s("id")) }) {
                Icon(Icons.Outlined.MyLocation, contentDescription = null, modifier = Modifier.size(16.dp))
                Spacer(Modifier.width(6.dp))
                Text("回到今天", maxLines = 1, softWrap = false)
            }
        }
        if (nextActivity != null) {
            val start = nextActivity.o("payload").o("time").s("start")
            SecondaryButton(onClick = { onJumpNext(nextActivity.s("id")) }) {
                Icon(Icons.Outlined.ArrowDownward, contentDescription = null, modifier = Modifier.size(16.dp))
                Spacer(Modifier.width(6.dp))
                Text(
                    if (start.isNotEmpty()) "下一项 $start" else "下一项",
                    maxLines = 1,
                    softWrap = false,
                )
            }
        }
    }
}
