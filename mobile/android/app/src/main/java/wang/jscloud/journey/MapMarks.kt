package wang.jscloud.journey

import androidx.compose.foundation.layout.*
import androidx.compose.ui.unit.dp
import androidx.compose.material3.*
import androidx.compose.runtime.*
import org.json.JSONObject
import kotlin.math.hypot

val markIcons = linkedMapOf("circle" to "●", "triangle" to "▲", "square" to "■", "diamond" to "◆", "hexagon" to "⬢", "star" to "★", "heart" to "♥", "flag" to "⚑")
val markColors = linkedMapOf("blue" to "#176b88", "green" to "#2f7a5a", "coral" to "#c8553d", "amber" to "#b7791f", "purple" to "#7a4f9a", "rose" to "#b8457a", "sky" to "#3f7fbf", "graphite" to "#4a5560")
val markColorNames = linkedMapOf("blue" to "海图蓝", "green" to "森林绿", "coral" to "珊瑚红", "amber" to "琥珀", "purple" to "梅紫", "rose" to "玫红", "sky" to "天蓝", "graphite" to "石墨")
fun markKey(mark: JSONObject) = mark.s("icon") + ":" + mark.s("color")
fun markTitle(mark: JSONObject) = (markIcons[mark.s("icon")] ?: "●") + " " + (markColorNames[mark.s("color")] ?: "海图蓝")

data class ClusterPoint(val id: String, val x: Double, val y: Double, val mark: String, val priority: Int = 0)
fun clusterFavorites(points: List<ClusterPoint>, previous: List<List<String>> = emptyList()): List<List<String>> {
    val groups = points.sortedWith(compareByDescending<ClusterPoint> { it.priority }.thenBy { it.id }).map { mutableListOf(it) }.toMutableList()
    for (same in listOf(true, false)) {
        var i = 0
        while (i < groups.size) {
            var j = i + 1
            while (j < groups.size) {
                val a = groups[i]; val b = groups[j]; val all = a + b
                val retained = previous.any { group -> all.all { it.id in group } }
                val threshold = if (same) { if (retained) 40 else 34 } else { if (retained) 30 else 24 }
                if (all.all { it.priority == 0 } && (!same || all.map { it.mark }.distinct().size == 1) && hypot(a.map { it.x }.average() - b.map { it.x }.average(), a.map { it.y }.average() - b.map { it.y }.average()) < threshold) {
                    a.addAll(b); groups.removeAt(j)
                } else j++
            }
            i++
        }
    }
    return groups.map { group -> group.map { it.id } }
}

@Composable
fun MarkEditor(s: JourneyStore, initial: JSONObject, favorite: JSONObject? = null, preset: JSONObject? = null, close: () -> Unit, applied: (JSONObject) -> Unit = {}) {
    var icon by remember { mutableStateOf(initial.s("icon", "circle")) }
    var color by remember { mutableStateOf(initial.s("color", "blue")) }
    var name by remember { mutableStateOf(preset?.o("payload")?.s("name").orEmpty()) }
    var savePreset by remember { mutableStateOf(false) }
    var confirm by remember { mutableStateOf(false) }
    val mark = obj("icon" to icon, "color" to color)
    val used = s.objects("favorite").count { it.s("state") == "active" && markKey(it.o("payload").o("mark")) == markKey(initial) }
    fun save() { s.action {
        if (favorite != null) s.mutate("patch", favorite.s("id"), patch = obj("mark" to mark))
        if (preset != null) s.mutate("patch", preset.s("id"), patch = obj("icon" to icon, "color" to color, "name" to name))
        else if (savePreset) s.mutate("create", objectType = "markPreset", patch = obj("icon" to icon, "color" to color, "name" to name))
        applied(mark); close()
    } }
    Sheet(if (preset == null) "自定义标记" else "编辑预设", close, onDone = { if (preset != null && used > 0 && markKey(mark) != markKey(initial)) confirm = true else save() }) {
        Text(markTitle(mark), style = MaterialTheme.typography.headlineLarge, color = androidx.compose.ui.graphics.Color(android.graphics.Color.parseColor(markColors[color])))
        SearchableSetupChoice("图标", markIcons[icon].orEmpty(), markIcons, selectedId = icon) { icon = it }
        SearchableSetupChoice("颜色", markColorNames[color].orEmpty(), markColorNames, selectedId = color) { color = it }
        if (preset == null) Row { Checkbox(savePreset, { savePreset = it }); Text("存为预设") }
        if (preset != null || savePreset) Field("它代表什么（选填）", name, { name = it.take(12) })
    }
    if (confirm) AlertDialog(onDismissRequest = { confirm = false }, title = { Text("有 $used 个地点在用这个标记，一起改吗？") }, confirmButton = { TextButton({ save() }) { Text("一起修改") } }, dismissButton = { TextButton({ confirm = false }) { Text("取消") } })
}

@Composable
fun MarkPresetManager(s: JourneyStore, close: () -> Unit) {
    val presets = s.objects("markPreset").filter { it.s("state") == "active" }.sortedBy { it.o("payload").optDouble("order", 0.0) }
    var editing by remember { mutableStateOf<JSONObject?>(null) }
    Sheet("管理预设", close) {
        presets.forEachIndexed { index, preset ->
            Panel {
                TextButton({ editing = preset }) { Text(markTitle(preset.o("payload")) + " · " + preset.o("payload").s("name").ifBlank { "未命名" }) }
                Row {
                    TextButton({ s.action { val reordered = presets.toMutableList().apply { add(index - 1, removeAt(index)) }; reordered.forEachIndexed { n, row -> s.mutate("patch", row.s("id"), patch = obj("order" to n * 1024)) } } }, enabled = index > 0) { Text("上移") }
                    TextButton({ s.action { val reordered = presets.toMutableList().apply { add(index + 1, removeAt(index)) }; reordered.forEachIndexed { n, row -> s.mutate("patch", row.s("id"), patch = obj("order" to n * 1024)) } } }, enabled = index < presets.lastIndex) { Text("下移") }
                }
                ObjectActions(s, preset)
            }
        }
    }
    editing?.let { preset -> MarkEditor(s, obj("icon" to preset.o("payload").s("icon"), "color" to preset.o("payload").s("color")), preset = preset, close = { editing = null }) }
}

fun sameMapPlace(a: JSONObject, b: JSONObject): Boolean {
    if (a.s("providerPlaceId").isNotBlank() && b.s("providerPlaceId").isNotBlank()) return a.s("providerPlaceId") == b.s("providerPlaceId") && a.s("provider") == b.s("provider")
    return !a.isNull("lng") && !b.isNull("lng") && !a.isNull("lat") && !b.isNull("lat") && a.optDouble("lng") == b.optDouble("lng") && a.optDouble("lat") == b.optDouble("lat")
}

fun mapPlacePayload(place: JSONObject): JSONObject {
    val result = JSONObject()
    listOf("name", "address", "lng", "lat", "provider", "providerPlaceId", "category", "sourceUrl", "fetchedAt", "coordSystem").forEach { key -> if (place.has(key)) result.put(key, place.get(key)) }
    return result
}
