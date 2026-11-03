package wang.jscloud.journey

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.unit.dp

@Composable
fun TripRangeCalendar(start: String, end: String, originalStart: String, originalCount: Int, onRange: (String, String) -> Unit) {
    val initial = runCatching { java.time.LocalDate.parse(start) }.getOrElse { java.time.LocalDate.now() }
    var month by remember { mutableStateOf(java.time.YearMonth.from(initial)) }
    var selectingEnd by remember { mutableStateOf(false) }
    val first = month.atDay(1)
    val offset = first.dayOfWeek.value - 1
    val from = runCatching { java.time.LocalDate.parse(start) }.getOrNull()
    val to = runCatching { java.time.LocalDate.parse(end) }.getOrNull()
    val old = runCatching { java.time.LocalDate.parse(originalStart) }.getOrNull()
    Column {
        Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
            TextButton({ month = month.minusMonths(1) }) { Text("‹ 上月") }
            Text("${month.year} 年 ${month.monthValue} 月", androidx.compose.ui.Modifier.weight(1f))
            TextButton({ month = month.plusMonths(1) }) { Text("下月 ›") }
        }
        Text(if (selectingEnd) "再点结束日期" else "点选开始日期", style = MaterialTheme.typography.bodySmall)
        Row { listOf("一", "二", "三", "四", "五", "六", "日").forEach { Text(it, androidx.compose.ui.Modifier.weight(1f), textAlign = androidx.compose.ui.text.style.TextAlign.Center) } }
        val rows = (offset + month.lengthOfMonth() + 6) / 7
        repeat(rows) { row -> Row {
            repeat(7) { col ->
                val day = row * 7 + col - offset + 1
                if (day !in 1..month.lengthOfMonth()) Spacer(androidx.compose.ui.Modifier.weight(1f).height(42.dp))
                else {
                    val date = month.atDay(day)
                    val selected = from != null && to != null && date >= from && date <= to
                    val removed = old != null && date >= old && date < old.plusDays(originalCount.toLong()) && !selected
                    TextButton({
                        if (selectingEnd && from != null) onRange(minOf(from, date).toString(), maxOf(from, date).toString())
                        else onRange(date.toString(), date.toString())
                        selectingEnd = !selectingEnd
                    }, modifier = androidx.compose.ui.Modifier.weight(1f).height(42.dp).drawBehind {
                        if (removed) drawRoundRect(color = androidx.compose.ui.graphics.Color.Gray, style = androidx.compose.ui.graphics.drawscope.Stroke(width = 1.dp.toPx(), pathEffect = androidx.compose.ui.graphics.PathEffect.dashPathEffect(floatArrayOf(3.dp.toPx(), 3.dp.toPx()))), cornerRadius = androidx.compose.ui.geometry.CornerRadius(6.dp.toPx()))
                    }, colors = ButtonDefaults.textButtonColors(containerColor = if (selected) MaterialTheme.colorScheme.primary else androidx.compose.ui.graphics.Color.Transparent, contentColor = if (selected) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface), contentPadding = PaddingValues(0.dp)) { Text(day.toString()) }
                }
            }
        } }
    }
}
