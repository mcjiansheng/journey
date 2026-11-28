package wang.jscloud.journey

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Label
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.Route
import androidx.compose.material.icons.outlined.Tune
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import java.math.BigDecimal
import java.time.LocalDate
import java.time.temporal.ChronoUnit
import org.json.JSONObject

object MapFilterOptions {
    val layers = listOf("全部", "行程", "收藏")
    val categories = listOf("全部", "餐饮", "景点", "住宿", "交通", "其他")
    val arranged = listOf("全部", "已安排", "未安排")
}

data class MapFilterState(
    val layer: String = "全部",
    val category: String = "全部",
    val arranged: String = "全部",
    val mark: String? = null,
) {
    val activeCount: Int
        get() =
            listOf(
                layer != "全部",
                category != "全部",
                arranged != "全部",
                !mark.isNullOrBlank(),
            ).count { it }

    val hasActiveFilter: Boolean
        get() = activeCount > 0
}

data class MapLegendEntry(
    val id: String,
    val key: String,
    val name: String,
    val mark: JSONObject,
    val count: Int,
)

data class MapActivityItem(
    val activity: JSONObject,
    val order: Int,
)

data class MapFilteredData(
    val days: List<JSONObject>,
    val presets: List<JSONObject>,
    val effectiveMarkFilter: String?,
    val favorites: List<JSONObject>,
    val usedPresets: List<JSONObject>,
    val legend: List<MapLegendEntry>,
    val activeActivities: List<JSONObject>,
    val visibleFavorites: List<JSONObject>,
    val mapActivities: List<MapActivityItem>,
    val favoriteMarkers: List<JSONObject>,
    val activityMarkers: List<MapActivityItem>,
    val routes: List<JSONObject>,
)

private val categoryFoodRegex = Regex("餐|食|咖啡|茶")
private val categoryHotelRegex = Regex("住宿|酒店")
private val categorySightRegex = Regex("景|公园|博物|文化")
private val categoryTransitRegex = Regex("交通|机场|车站")

fun placeLocated(place: JSONObject?): Boolean {
    if (place == null) return false
    val lng = place.opt("lng") as? Number ?: return false
    val lat = place.opt("lat") as? Number ?: return false
    return lng.toDouble().isFinite() && lat.toDouble().isFinite()
}

private fun keyJsonToken(value: Any?): String =
    when (value) {
        null,
        JSONObject.NULL -> "null"
        is Number -> {
            val d = value.toDouble()
            if (!d.isFinite()) "null"
            else if (d == 0.0) "0"
            else BigDecimal.valueOf(d).stripTrailingZeros().toPlainString()
        }
        is String -> JSONObject.quote(value)
        else -> value.toString()
    }

fun placeKey(place: JSONObject?): String {
    val providerPlaceId = place?.s("providerPlaceId").orEmpty()
    if (providerPlaceId.isNotEmpty()) return "amap:$providerPlaceId"
    fun field(k: String): Any? =
        if (place == null || !place.has(k) || place.isNull(k)) null else place.opt(k)
    return listOf("name", "address", "lng", "lat").joinToString(",", "[", "]") {
        keyJsonToken(field(it))
    }
}

fun placeCategory(place: JSONObject?): String {
    val raw = place?.s("category").orEmpty()
    return when {
        categoryFoodRegex.containsMatchIn(raw) -> "餐饮"
        categoryHotelRegex.containsMatchIn(raw) -> "住宿"
        categorySightRegex.containsMatchIn(raw) -> "景点"
        categoryTransitRegex.containsMatchIn(raw) -> "交通"
        else -> "其他"
    }
}

/** Port of `visibleDays` from `app/src/domain.js`. */
fun visibleDays(snapshot: JSONObject?): List<JSONObject> {
    val trip = snapshot?.optJSONObject("trip") ?: return emptyList()
    val startDate = trip.s("startDate")
    val dayCount = trip.optInt("dayCount", 0)
    val endDate =
        if (startDate.isNotEmpty()) {
            runCatching { LocalDate.parse(startDate).plusDays(dayCount.toLong()).toString() }
                .getOrNull() ?: return emptyList()
        } else null
    return snapshot
        .a("objects")
        .rows()
        .filter { o ->
            if (o.s("kind") != "day" || o.s("state") != "active") return@filter false
            val payload = o.o("payload")
            val date = payload.s("date")
            if (startDate.isNotEmpty()) {
                date.isNotEmpty() && date >= startDate && date < endDate!!
            } else {
                date.isEmpty() && payload.optInt("ordinal", 0) in 1..dayCount
            }
        }
        .sortedWith(
            if (startDate.isNotEmpty()) compareBy { it.o("payload").s("date") }
            else compareBy { it.o("payload").optInt("ordinal", 0) }
        )
}

/** Port of `dayLabel` from `app/src/domain.js`. */
fun dayLabel(day: JSONObject, trip: JSONObject?): String {
    val payload = day.o("payload")
    val startDate = trip?.s("startDate").orEmpty()
    val dayDate = payload.s("date")
    val n =
        if (startDate.isNotEmpty() && dayDate.isNotEmpty()) {
            runCatching {
                ChronoUnit.DAYS.between(LocalDate.parse(startDate), LocalDate.parse(dayDate))
                    .toInt() + 1
            }.getOrElse { payload.optInt("ordinal", 0) }
        } else {
            payload.optInt("ordinal", 0)
        }
    return "第${n}天"
}

fun activePresets(objects: List<JSONObject>): List<JSONObject> =
    objects
        .filter { it.s("kind") == "markPreset" && it.s("state") == "active" }
        .sortedBy { it.o("payload").optDouble("order", 0.0) }

fun resolveMarkFilter(requestedMark: String?, presets: List<JSONObject>): String? {
    if (requestedMark.isNullOrBlank()) return null
    return requestedMark.takeIf { key -> presets.any { markKey(it.o("payload")) == key } }
}

fun presetDisplayName(place: JSONObject, presets: List<JSONObject>): String {
    val key = markKey(rawMark(place))
    val matched = presets.firstOrNull { markKey(it.o("payload")) == key }?.o("payload")?.s("name")
    return if (!matched.isNullOrEmpty()) matched else markLabel(effectiveMark(place))
}

fun usedPresets(presets: List<JSONObject>, favorites: List<JSONObject>): List<JSONObject> =
    presets.filter { preset ->
        val key = markKey(preset.o("payload"))
        favorites.any { fav -> markKey(rawMark(fav.o("payload"))) == key }
    }

fun buildMapLegend(
    usedPresets: List<JSONObject>,
    favorites: List<JSONObject>,
): List<MapLegendEntry> =
    usedPresets.map { preset ->
        val payload = preset.o("payload")
        val key = markKey(payload)
        val count = favorites.count { fav -> markKey(rawMark(fav.o("payload"))) == key }
        val name = payload.s("name").ifBlank { markLabel(payload) }
        MapLegendEntry(
            id = preset.s("id"),
            key = key,
            name = name,
            mark = payload,
            count = count,
        )
    }

fun isPlaceArranged(place: JSONObject?, activeActivities: List<JSONObject>): Boolean {
    if (place == null) return false
    val targetKey = placeKey(place)
    return activeActivities.any { activity ->
        val activityPlace = activity.o("payload").optJSONObject("place")
        activityPlace != null && placeKey(activityPlace) == targetKey
    }
}

fun filterMapData(
    snapshot: JSONObject?,
    filter: MapFilterState,
    routeDayId: String? = null,
    selectedPlace: JSONObject? = null,
): MapFilteredData {
    val objects = snapshot?.a("objects")?.rows().orEmpty()
    val days = visibleDays(snapshot)
    val presets = activePresets(objects)
    val effectiveMarkFilter = resolveMarkFilter(filter.mark, presets)
    val favorites = objects.filter { it.s("kind") == "favorite" && it.s("state") == "active" }
    val used = usedPresets(presets, favorites)
    val legend = buildMapLegend(used, favorites)
    val activeDayIds =
        objects.filter { it.s("kind") == "day" && it.s("state") == "active" }.map { it.s("id") }.toSet()
    val activeActivities =
        objects.filter {
            it.s("kind") == "activity" &&
                it.s("state") == "active" &&
                it.o("payload").s("dayId") in activeDayIds
        }

    val visibleFavorites =
        favorites.filter { fav ->
            val payload = fav.o("payload")
            val matchesMark =
                effectiveMarkFilter == null || markKey(rawMark(payload)) == effectiveMarkFilter
            val matchesCategory =
                filter.category == "全部" || placeCategory(payload) == filter.category
            val arranged = isPlaceArranged(payload, activeActivities)
            val matchesArranged =
                filter.arranged == "全部" || arranged == (filter.arranged == "已安排")
            matchesMark && matchesCategory && matchesArranged
        }

    val dayList =
        if (!routeDayId.isNullOrBlank()) days.filter { it.s("id") == routeDayId } else days
    val mapActivities =
        dayList
            .flatMap { day ->
                orderedActivities(objects, day.s("id")).mapIndexed { index, activity ->
                    MapActivityItem(activity = activity, order = index + 1)
                }
            }
            .filter { (activity, _) ->
                filter.layer != "收藏" &&
                    filter.arranged != "未安排" &&
                    (filter.category == "全部" ||
                        placeCategory(activity.o("payload").optJSONObject("place")) == filter.category)
            }

    val selectedKey = selectedPlace?.let(::placeKey)
    val activityPlaceKeys =
        mapActivities.mapNotNull { it.activity.o("payload").optJSONObject("place")?.let(::placeKey) }.toSet()

    val favoriteMarkers =
        if (filter.layer == "行程") emptyList()
        else {
            visibleFavorites.filter { fav ->
                val payload = fav.o("payload")
                placeLocated(payload) &&
                    (selectedKey == null || placeKey(payload) != selectedKey) &&
                    placeKey(payload) !in activityPlaceKeys
            }
        }

    val activityMarkers =
        mapActivities.filter { (activity, _) ->
            val place = activity.o("payload").optJSONObject("place")
            placeLocated(place) && (selectedKey == null || placeKey(place) != selectedKey)
        }

    val routeActivities =
        if (!routeDayId.isNullOrBlank() && routeDayId in activeDayIds) {
            orderedActivities(objects, routeDayId)
        } else {
            emptyList()
        }
    val mapActivityIds = mapActivities.map { it.activity.s("id") }.toSet()
    val routes = buildList {
        if (filter.layer != "收藏") {
            for (i in 1 until routeActivities.size) {
                val from = routeActivities[i - 1]
                val to = routeActivities[i]
                if (from.s("id") !in mapActivityIds || to.s("id") !in mapActivityIds) continue
                val fromPlace = from.o("payload").optJSONObject("place")
                val toPlace = to.o("payload").optJSONObject("place")
                if (!placeLocated(fromPlace) || !placeLocated(toPlace)) continue
                val route =
                    objects.firstOrNull {
                        it.s("kind") == "route" &&
                            it.s("state") == "active" &&
                            it.o("payload").s("fromId") == from.s("id") &&
                            it.o("payload").s("toId") == to.s("id")
                    } ?: continue
                val payload = route.o("payload")
                if (payload.a("path").length() == 0) continue
                if (payload.s("inputSignature") != routeSignature(from, to, payload.s("mode"))) continue
                add(route)
            }
        }
    }

    return MapFilteredData(
        days = days,
        presets = presets,
        effectiveMarkFilter = effectiveMarkFilter,
        favorites = favorites,
        usedPresets = used,
        legend = legend,
        activeActivities = activeActivities,
        visibleFavorites = visibleFavorites,
        mapActivities = mapActivities,
        favoriteMarkers = favoriteMarkers,
        activityMarkers = activityMarkers,
        routes = routes,
    )
}

@Composable
private fun mapChipColors(): SelectableChipColors {
    val palette = LocalJourneyPalette.current
    return FilterChipDefaults.filterChipColors(
        containerColor = palette.card,
        labelColor = palette.text,
        iconColor = palette.muted,
        selectedContainerColor = palette.selected,
        selectedLabelColor = palette.primary,
        selectedLeadingIconColor = palette.primary,
    )
}

@Composable
private fun mapChipBorder(selected: Boolean): BorderStroke {
    val palette = LocalJourneyPalette.current
    return BorderStroke(1.dp, if (selected) palette.primary else palette.border)
}

@Composable
fun MapFilterBar(
    trip: JSONObject?,
    days: List<JSONObject>,
    routeDayId: String?,
    onRouteDayChange: (String?) -> Unit,
    filter: MapFilterState,
    legend: List<MapLegendEntry>,
    onOpenFilter: () -> Unit,
    onOpenLegend: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var dayMenuOpen by remember { mutableStateOf(false) }
    val selectedDay = days.firstOrNull { it.s("id") == routeDayId }
    val routeText = if (selectedDay != null) "${dayLabel(selectedDay, trip)}路线" else "全部地点"
    val activeLegend = legend.firstOrNull { it.key == filter.mark }

    Row(
        modifier = modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (days.isNotEmpty()) {
            Box {
                FilterChip(
                    selected = selectedDay != null,
                    onClick = { dayMenuOpen = true },
                    modifier = Modifier.testTag("map-route-picker"),
                    leadingIcon = { Icon(Icons.Outlined.Route, null, Modifier.size(16.dp)) },
                    trailingIcon = { Icon(Icons.Outlined.ExpandMore, null, Modifier.size(16.dp)) },
                    label = { Text(routeText, maxLines = 1) },
                    colors = mapChipColors(),
                    border = mapChipBorder(selectedDay != null),
                )
                DropdownMenu(expanded = dayMenuOpen, onDismissRequest = { dayMenuOpen = false }) {
                    DropdownMenuItem(
                        text = { Text("全部地点") },
                        trailingIcon = {
                            if (selectedDay == null) Icon(Icons.Outlined.Check, null)
                        },
                        onClick = {
                            onRouteDayChange(null)
                            dayMenuOpen = false
                        },
                    )
                    days.forEach { day ->
                        val date = day.o("payload").s("date")
                        val label =
                            if (date.isNotEmpty()) "${dayLabel(day, trip)} · ${date.drop(5).replace('-', '/')}"
                            else dayLabel(day, trip)
                        DropdownMenuItem(
                            text = { Text(label) },
                            trailingIcon = {
                                if (day.s("id") == routeDayId) Icon(Icons.Outlined.Check, null)
                            },
                            onClick = {
                                onRouteDayChange(day.s("id"))
                                dayMenuOpen = false
                            },
                        )
                    }
                }
            }
        }
        FilterChip(
            selected = filter.hasActiveFilter,
            onClick = onOpenFilter,
            modifier = Modifier.testTag("map-filter-button"),
            leadingIcon = { Icon(Icons.Outlined.Tune, null, Modifier.size(16.dp)) },
            label = {
                Text(
                    if (filter.activeCount > 0) "筛选 · ${filter.activeCount}" else "筛选",
                    maxLines = 1,
                )
            },
            colors = mapChipColors(),
            border = mapChipBorder(filter.hasActiveFilter),
        )
        if (legend.isNotEmpty()) {
            FilterChip(
                selected = activeLegend != null,
                onClick = onOpenLegend,
                modifier = Modifier.testTag("map-legend-button"),
                leadingIcon = {
                    if (activeLegend != null) {
                        Text(
                            markGlyph(activeLegend.mark),
                            color = Color(android.graphics.Color.parseColor(markColorHex(activeLegend.mark))),
                            style = MaterialTheme.typography.labelLarge,
                        )
                    } else {
                        Icon(Icons.AutoMirrored.Outlined.Label, null, Modifier.size(16.dp))
                    }
                },
                label = {
                    Text(
                        activeLegend?.name ?: "图例 ${legend.size}",
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                },
                colors = mapChipColors(),
                border = mapChipBorder(activeLegend != null),
            )
        }
    }
}

@Composable
fun MapLegendStrip(
    legend: List<MapLegendEntry>,
    activeMark: String?,
    onToggleMark: (String?) -> Unit,
    modifier: Modifier = Modifier,
) {
    if (legend.isEmpty()) return
    Row(
        modifier = modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        legend.forEach { entry ->
            val selected = activeMark == entry.key
            FilterChip(
                selected = selected,
                onClick = { onToggleMark(if (selected) null else entry.key) },
                modifier = Modifier.testTag("map-legend-chip-${entry.key}"),
                leadingIcon = {
                    Text(
                        markGlyph(entry.mark),
                        color = Color(android.graphics.Color.parseColor(markColorHex(entry.mark))),
                        style = MaterialTheme.typography.titleSmall,
                    )
                },
                trailingIcon = {
                    if (selected) Icon(Icons.Outlined.Check, null, Modifier.size(16.dp))
                },
                label = { Text("${entry.name} ${entry.count}", maxLines = 1) },
                colors = mapChipColors(),
                border = mapChipBorder(selected),
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun MapFilterBottomSheet(
    current: MapFilterState,
    legend: List<MapLegendEntry>,
    onDismiss: () -> Unit,
    onApply: (MapFilterState) -> Unit,
) {
    val palette = LocalJourneyPalette.current
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var draft by remember(current) { mutableStateOf(current) }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = palette.elevated,
        contentColor = palette.text,
    ) {
        Column(
            modifier =
                Modifier.fillMaxWidth()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 20.dp)
                    .padding(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("筛选地点", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Medium)
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    if (draft.hasActiveFilter) {
                        TextButton({ draft = MapFilterState() }) { Text("重置") }
                    }
                    TextButton(onDismiss) { Text("取消") }
                }
            }

            FilterSection("显示") {
                MapFilterOptions.layers.forEach { layer ->
                    val selected = draft.layer == layer
                    FilterChip(
                        selected = selected,
                        onClick = { draft = draft.copy(layer = layer) },
                        label = { Text(layer) },
                        colors = mapChipColors(),
                        border = mapChipBorder(selected),
                    )
                }
            }

            if (legend.isNotEmpty()) {
                FilterSection("标记") {
                    val allSelected = draft.mark == null
                    FilterChip(
                        selected = allSelected,
                        onClick = { draft = draft.copy(mark = null) },
                        label = { Text("全部") },
                        colors = mapChipColors(),
                        border = mapChipBorder(allSelected),
                    )
                    legend.forEach { entry ->
                        val selected = draft.mark == entry.key
                        FilterChip(
                            selected = selected,
                            onClick = { draft = draft.copy(mark = entry.key) },
                            leadingIcon = {
                                Text(
                                    markGlyph(entry.mark),
                                    color = Color(android.graphics.Color.parseColor(markColorHex(entry.mark))),
                                    style = MaterialTheme.typography.titleSmall,
                                )
                            },
                            label = { Text("${entry.name} · ${entry.count}") },
                            colors = mapChipColors(),
                            border = mapChipBorder(selected),
                        )
                    }
                }
            }

            FilterSection("类别") {
                MapFilterOptions.categories.forEach { category ->
                    val selected = draft.category == category
                    FilterChip(
                        selected = selected,
                        onClick = { draft = draft.copy(category = category) },
                        label = { Text(category) },
                        colors = mapChipColors(),
                        border = mapChipBorder(selected),
                    )
                }
            }

            FilterSection("安排状态") {
                MapFilterOptions.arranged.forEach { arranged ->
                    val selected = draft.arranged == arranged
                    FilterChip(
                        selected = selected,
                        onClick = { draft = draft.copy(arranged = arranged) },
                        label = { Text(arranged) },
                        colors = mapChipColors(),
                        border = mapChipBorder(selected),
                    )
                }
            }

            Button(
                onClick = { onApply(draft) },
                modifier = Modifier.fillMaxWidth().testTag("map-filter-apply"),
            ) {
                Text("完成")
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun FilterSection(title: String, content: @Composable FlowRowScope.() -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(
            title,
            style = MaterialTheme.typography.labelLarge,
            color = LocalJourneyPalette.current.muted,
        )
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
            content = content,
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MapLegendBottomSheet(
    legend: List<MapLegendEntry>,
    activeMark: String?,
    onSelectMark: (String?) -> Unit,
    onDismiss: () -> Unit,
) {
    val palette = LocalJourneyPalette.current
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = palette.elevated,
        contentColor = palette.text,
    ) {
        Column(
            modifier =
                Modifier.fillMaxWidth()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 20.dp)
                    .padding(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("标记图例", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Medium)
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    if (activeMark != null) {
                        TextButton({
                            onSelectMark(null)
                            onDismiss()
                        }) {
                            Text("显示全部")
                        }
                    }
                    TextButton(onDismiss) { Text("关闭") }
                }
            }
            legend.forEach { entry ->
                val selected = activeMark == entry.key
                Surface(
                    onClick = {
                        onSelectMark(if (selected) null else entry.key)
                        onDismiss()
                    },
                    shape = RoundedCornerShape(16.dp),
                    color = if (selected) palette.selected else palette.card,
                    border = BorderStroke(1.dp, if (selected) palette.primary else palette.border),
                    modifier =
                        Modifier.fillMaxWidth().semantics {
                            contentDescription = "${entry.name} ${entry.count} 个收藏"
                        },
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 14.dp),
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            markGlyph(entry.mark),
                            color = Color(android.graphics.Color.parseColor(markColorHex(entry.mark))),
                            style = MaterialTheme.typography.titleLarge,
                        )
                        Text(
                            entry.name,
                            style = MaterialTheme.typography.bodyLarge,
                            color = if (selected) palette.primary else palette.text,
                            modifier = Modifier.weight(1f),
                        )
                        Text(
                            "${entry.count}",
                            style = MaterialTheme.typography.labelLarge,
                            color = if (selected) palette.primary else palette.muted,
                        )
                        if (selected) {
                            Icon(
                                Icons.Outlined.Check,
                                contentDescription = "已选中",
                                tint = palette.primary,
                            )
                        }
                    }
                }
            }
        }
    }
}
