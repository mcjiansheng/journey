package wang.jscloud.journey

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.ui.semantics.Role
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import java.time.ZoneId
import java.time.format.TextStyle
import java.util.Locale

@Composable
fun TeamModeCards(mode: String, set: (String) -> Unit, enabled: Boolean = true) {
    Column(Modifier.selectableGroup(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text("团队模式", style = MaterialTheme.typography.titleSmall)
        Text("所有成员都能添加和编辑内容。", style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        listOf(
            Triple("admin", "管理员团队", "创建者与管理员可直接删除。成员可表达自己的意见。"),
            Triple("equal", "平等团队", "成员通过集体表态删除内容。创建者也可直接删除。"),
        ).forEach { (value, title, description) ->
            val selected = mode == value
            Card(modifier = Modifier.fillMaxWidth().selectable(selected = selected, enabled = enabled,
                role = Role.RadioButton, onClick = { set(value) }),
                colors = CardDefaults.cardColors(containerColor = if (selected)
                    MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surface),
                border = BorderStroke(1.dp, if (selected) MaterialTheme.colorScheme.primary else LocalJourneyPalette.current.border)) {
                Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Icon(if (value == "admin") Icons.Outlined.ManageAccounts else Icons.Outlined.Groups,
                        null, tint = MaterialTheme.colorScheme.primary)
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(title, style = MaterialTheme.typography.titleMedium)
                        Text(description, style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Icon(if (selected) Icons.Outlined.CheckCircle else Icons.Outlined.RadioButtonUnchecked,
                        null, tint = MaterialTheme.colorScheme.primary)
                }
            }
        }
    }
}

internal val tripTimezones = linkedMapOf(
    "Asia/Shanghai" to "中国大陆 · 北京、上海",
    "Asia/Hong_Kong" to "中国香港",
    "Asia/Macau" to "中国澳门",
    "Asia/Taipei" to "中国台湾 · 台北",
    "Asia/Tokyo" to "日本 · 东京",
    "Asia/Seoul" to "韩国 · 首尔",
    "Asia/Singapore" to "新加坡",
    "Asia/Bangkok" to "泰国 · 曼谷",
    "Asia/Ho_Chi_Minh" to "越南 · 胡志明市",
    "Asia/Kuala_Lumpur" to "马来西亚 · 吉隆坡",
    "Asia/Jakarta" to "印度尼西亚 · 雅加达",
    "Asia/Kolkata" to "印度 · 新德里",
    "Asia/Dubai" to "阿联酋 · 迪拜",
    "Europe/London" to "英国 · 伦敦",
    "Europe/Paris" to "法国 · 巴黎",
    "Europe/Berlin" to "德国 · 柏林",
    "Europe/Rome" to "意大利 · 罗马",
    "Europe/Moscow" to "俄罗斯 · 莫斯科",
    "America/New_York" to "美国东部 · 纽约",
    "America/Chicago" to "美国中部 · 芝加哥",
    "America/Denver" to "美国山地 · 丹佛",
    "America/Los_Angeles" to "美国西部 · 洛杉矶",
    "America/Vancouver" to "加拿大西部 · 温哥华",
    "America/Toronto" to "加拿大东部 · 多伦多",
    "Pacific/Honolulu" to "美国夏威夷 · 檀香山",
    "Australia/Sydney" to "澳大利亚东部 · 悉尼",
    "Australia/Perth" to "澳大利亚西部 · 珀斯",
    "Pacific/Auckland" to "新西兰 · 奥克兰",
    "UTC" to "协调世界时",
)

internal fun timezoneLabel(zone: String): String {
    tripTimezones[zone]?.let { return it }
    val name = ZoneId.of(zone).getDisplayName(TextStyle.FULL, Locale.SIMPLIFIED_CHINESE)
    val city = android.icu.text.TimeZoneNames.getInstance(android.icu.util.ULocale.SIMPLIFIED_CHINESE)
        ?.getExemplarLocationName(zone) ?: zone.substringAfterLast('/').replace('_', ' ')
    return if (city == name || !zone.contains('/')) name else "$name · $city"
}

internal fun searchTripTimezones(query: String): Map<String, String> {
    val text = query.trim()
    if (text.isEmpty()) return tripTimezones
    val matches = linkedMapOf<String, String>()
    tripTimezones.filter { (id, label) -> id.contains(text, true) || label.contains(text, true) }
        .let { matches.putAll(it) }
    ZoneId.getAvailableZoneIds().sorted().forEach { id ->
        if (id !in matches) {
            val label = timezoneLabel(id)
            if (id.contains(text, true) || label.contains(text, true)) matches[id] = label
        }
    }
    return matches
}

internal val tripCurrencies = linkedMapOf(
    "CNY" to "人民币 · CNY", "HKD" to "港币 · HKD", "TWD" to "新台币 · TWD",
    "MOP" to "澳门元 · MOP", "JPY" to "日元 · JPY", "KRW" to "韩元 · KRW",
    "USD" to "美元 · USD", "EUR" to "欧元 · EUR", "GBP" to "英镑 · GBP",
    "SGD" to "新加坡元 · SGD", "THB" to "泰铢 · THB", "MYR" to "马来西亚林吉特 · MYR",
    "AUD" to "澳大利亚元 · AUD", "CAD" to "加拿大元 · CAD", "NZD" to "新西兰元 · NZD",
    "CHF" to "瑞士法郎 · CHF", "AED" to "阿联酋迪拉姆 · AED", "VND" to "越南盾 · VND",
    "IDR" to "印度尼西亚盾 · IDR", "INR" to "印度卢比 · INR",
)

@Composable
fun SearchableSetupChoice(label: String, selectedLabel: String, options: Map<String, String>,
    selectedId: String? = null, searchOptions: ((String) -> Map<String, String>)? = null,
    choose: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    var query by remember { mutableStateOf("") }
    TextButton({ query = ""; open = true }, modifier = Modifier.fillMaxWidth()) {
        Text(label, Modifier.weight(1f), color = MaterialTheme.colorScheme.onSurface)
        Text(selectedLabel, modifier = Modifier.weight(2f), maxLines = 2)
        Icon(Icons.Outlined.ExpandMore, null)
    }
    if (open) AlertDialog(onDismissRequest = { open = false }, title = { Text(label) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Field("搜索名称", query, { query = it })
                val filtered = remember(query, options) {
                    if (query.isNotBlank() && searchOptions != null) searchOptions(query)
                    else options.filter { (id, name) ->
                        name.contains(query.trim(), ignoreCase = true) || id.contains(query.trim(), ignoreCase = true)
                    }
                }
                if (filtered.isEmpty()) Text("没有找到匹配选项")
                LazyColumn(Modifier.height(320.dp)) {
                    items(filtered.entries.toList(), key = { it.key }) { (id, name) ->
                        TextButton({ choose(id); open = false }, modifier = Modifier.fillMaxWidth()) {
                            Text(name, Modifier.weight(1f))
                            if (if (selectedId != null) id == selectedId else name == selectedLabel) Icon(Icons.Outlined.Check, "已选择")
                        }
                    }
                }
            }
        }, confirmButton = { TextButton({ open = false }) { Text("完成") } })
}

internal fun createTripForm(name: String, destination: String, start: String, end: String,
    zone: String = ZoneId.systemDefault().id, currency: String = "CNY", mode: String = "admin"): org.json.JSONObject {
    val date = java.time.LocalDate.parse(start)
    val count = java.time.temporal.ChronoUnit.DAYS.between(date, java.time.LocalDate.parse(end)) + 1
    require(count in 1..365) { "日期范围需为 1–365 天" }
    return obj("name" to name.trim(), "destination" to destination.trim(), "startDate" to date.toString(),
        "dayCount" to count, "timezone" to zone, "currency" to currency, "teamMode" to mode)
}
