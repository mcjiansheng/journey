package wang.jscloud.journey

import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale
import org.json.JSONObject

internal fun linkedExpenseActivity(objects: List<JSONObject>, payload: JSONObject): JSONObject? =
    objects.find { it.s("id") == payload.s("activityId") && it.s("kind") == "activity" && it.s("state") == "active" }
        ?.takeIf { activity -> objects.any { it.s("id") == activity.o("payload").s("dayId") && it.s("kind") == "day" && it.s("state") == "active" } }

internal fun expenseDate(objects: List<JSONObject>, payload: JSONObject): String =
    payload.s("date").ifBlank {
        linkedExpenseActivity(objects, payload)?.let { activity ->
            objects.find { it.s("id") == activity.o("payload").s("dayId") }?.o("payload")?.s("date")
        } ?: ""
    }

internal fun expenseTitle(objects: List<JSONObject>, payload: JSONObject): String =
    payload.s("title").ifBlank { linkedExpenseActivity(objects, payload)?.o("payload")?.s("title").orEmpty() }
        .ifBlank { if (payload.o("payment").s("status") == "paid") "已支付" else "预计" }

internal fun expenseDateLabel(trip: JSONObject, date: String): String {
    if (date.isBlank()) return "未记录日期"
    val value = LocalDate.parse(date)
    val stamp = value.format(DateTimeFormatter.ofPattern("MM/dd E", Locale.CHINA))
    if (trip.s("startDate").isBlank()) return stamp
    val ordinal = java.time.temporal.ChronoUnit.DAYS.between(LocalDate.parse(trip.s("startDate")), value) + 1
    return when {
        ordinal < 1 -> "行前支付 · $stamp"
        ordinal > trip.optInt("dayCount") -> "行后支付 · $stamp"
        else -> "第 $ordinal 天 · $stamp"
    }
}

internal fun expenseActivityLabel(activity: JSONObject): String {
    val p = activity.o("payload")
    val time = p.o("time")
    val label = if (time.s("mode") == "precise") time.s("start") else
        mapOf("morning" to "上午", "afternoon" to "下午", "evening" to "晚上")[time.s("period")] ?: time.s("period")
    return listOf(p.s("title"), label).filter { it.isNotBlank() }.joinToString(" · ")
}
