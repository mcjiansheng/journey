package wang.jscloud.journey

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun MapPlaceDetailSheet(
    s: JourneyStore,
    place: JSONObject,
    placeInfo: PlaceInformationData?,
    placeInfoLoading: Boolean,
    favorites: List<JSONObject>,
    presets: List<JSONObject>,
    origin: JSONObject?,
    mode: String,
    routeText: String,
    lastMark: JSONObject,
    onDismiss: () -> Unit,
    onAddActivity: (JSONObject) -> Unit,
    onSetOrigin: (JSONObject) -> Unit,
    onModeChange: (String) -> Unit,
    onRouteResult: (JSONObject, String) -> Unit,
    onMarkApplied: (JSONObject) -> Unit,
    onCustomizeFavorite: (JSONObject) -> Unit,
    pointMark: (JSONObject) -> JSONObject,
) {
    val ctx = LocalContext.current
    val palette = LocalJourneyPalette.current
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = false)
    val scope = rememberCoroutineScope()
    val expanded = sheetState.currentValue == SheetValue.Expanded || sheetState.targetValue == SheetValue.Expanded
    val currentFavorite =
        favorites.firstOrNull { it.s("id") == place.s("_id") || sameMapPlace(it.o("payload"), place) }
    val hasCoords = !place.isNull("lng") && !place.isNull("lat")

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = palette.elevated,
        contentColor = palette.text,
        scrimColor = Color.Black.copy(alpha = 0.14f),
    ) {
        Column(
            modifier =
                Modifier.fillMaxWidth()
                    .fillMaxHeight(0.92f)
                    .padding(horizontal = 20.dp)
                    .padding(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text(
                        place.s("name"),
                        style = MaterialTheme.typography.titleLarge,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                    if (place.s("address").isNotBlank()) {
                        Text(
                            place.s("address"),
                            style = MaterialTheme.typography.bodySmall,
                            color = palette.muted,
                        )
                    }
                }
                IconButton(
                    onClick = {
                        scope.launch {
                            if (expanded) sheetState.partialExpand() else sheetState.expand()
                        }
                    }
                ) {
                    Icon(
                        if (expanded) Icons.Outlined.ExpandMore else Icons.Outlined.ExpandLess,
                        contentDescription = if (expanded) "收起到半屏" else "展开到全屏",
                    )
                }
                IconButton(onClick = onDismiss) {
                    Icon(Icons.Outlined.Close, contentDescription = "关闭地点详情")
                }
            }

            // Use FlowRow with non-wrapping button text so narrow viewports wrap cleanly instead of truncating labels.
            FlowRow(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Button(onClick = { onAddActivity(mapPlacePayload(place)) }) {
                    Icon(Icons.Outlined.Add, contentDescription = null, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(4.dp))
                    Text("加入行程", maxLines = 1, softWrap = false)
                }
                if (currentFavorite == null) {
                    SecondaryButton(
                        onClick = {
                            s.action {
                                val clean = mapPlacePayload(place).put("mark", lastMark)
                                s.mutate("create", objectType = "favorite", patch = clean)
                            }
                        }
                    ) {
                        Icon(Icons.Outlined.StarOutline, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("收藏", maxLines = 1, softWrap = false)
                    }
                } else {
                    SecondaryButton(onClick = {}, enabled = false) {
                        Icon(Icons.Outlined.Star, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("已收藏", maxLines = 1, softWrap = false)
                    }
                }
                SecondaryButton(onClick = { onSetOrigin(place) }) {
                    Icon(Icons.Outlined.AltRoute, contentDescription = null, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(4.dp))
                    Text("从这里出发", maxLines = 1, softWrap = false)
                }
                if (hasCoords) {
                    SecondaryButton(
                        onClick = {
                            val uri =
                                Uri.parse(
                                    "https://uri.amap.com/navigation?to=${place.optDouble("lng")},${place.optDouble("lat")},${JourneyApi.encode(place.s("name"))}&mode=car&coordinate=gaode&callnative=1"
                                )
                            runCatching { ctx.startActivity(Intent(Intent.ACTION_VIEW, uri)) }
                        }
                    ) {
                        Icon(Icons.Outlined.Navigation, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("导航", maxLines = 1, softWrap = false)
                    }
                }
            }

            Column(
                Modifier.weight(1f).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                PlaceInformationSection(
                    info = placeInfo,
                    placeName = place.s("name"),
                    expanded = expanded,
                    client = s.api.client,
                )
                if (placeInfoLoading) {
                    Text(
                        "正在载入地点…",
                        style = MaterialTheme.typography.bodySmall,
                        color = palette.muted,
                    )
                }
                currentFavorite?.let { favorite ->
                    Panel {
                        Text("标记", style = MaterialTheme.typography.titleSmall)
                        FlowRow(
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            presets.forEach { preset ->
                                val payload = preset.o("payload")
                                val mark = obj("icon" to payload.s("icon"), "color" to payload.s("color"))
                                val selected = markKey(pointMark(favorite.o("payload"))) == markKey(mark)
                                FilterChip(
                                    selected = selected,
                                    onClick = {
                                        s.action {
                                            s.mutate("patch", favorite.s("id"), patch = obj("mark" to mark))
                                            onMarkApplied(mark)
                                        }
                                    },
                                    label = {
                                        Text(
                                            markTitle(payload) + " " + payload.s("name").ifBlank { "未命名" },
                                            maxLines = 1,
                                            softWrap = false,
                                        )
                                    },
                                )
                            }
                            SecondaryButton(onClick = { onCustomizeFavorite(favorite) }) {
                                Text("自定义", maxLines = 1, softWrap = false)
                            }
                        }
                        ObjectActions(s, favorite)
                    }
                }
                if (origin != null) {
                    Panel {
                        Text("从 ${origin.s("name")} 到这里", style = MaterialTheme.typography.titleSmall)
                        Choice("交通", mode, listOf("步行", "驾车", "骑行"), onModeChange)
                        Button(
                            onClick = {
                                s.action {
                                    require(!origin.isNull("lng") && !place.isNull("lng")) { "地点缺少坐标" }
                                    val type =
                                        when (mode) {
                                            "驾车" -> "driving"
                                            "骑行" -> "bicycling"
                                            else -> "walking"
                                        }
                                    val url =
                                        "/_AMapService/${if (type == "bicycling") "v4" else "v3"}/direction/$type?origin=${origin.optDouble("lng")},${origin.optDouble("lat")}&destination=${place.optDouble("lng")},${place.optDouble("lat")}&extensions=all"
                                    val r = s.api.request(url)
                                    val paths =
                                        if (type == "bicycling") r.o("data").a("paths")
                                        else r.o("route").a("paths")
                                    val path =
                                        paths.rows().firstOrNull()
                                            ?: throw IllegalStateException("暂时没有可用路线")
                                    val coords =
                                        path.a("steps").rows().flatMap { step ->
                                            step.s("polyline").split(';').mapNotNull { v ->
                                                val ll = v.split(',')
                                                val lng = ll.getOrNull(0)?.toDoubleOrNull()
                                                val lat = ll.getOrNull(1)?.toDoubleOrNull()
                                                if (lng == null || lat == null) null
                                                else JSONArray(listOf(lng, lat))
                                            }
                                        }
                                    val minutes = path.optDouble("duration") / 60
                                    val routeObj =
                                        obj(
                                            "path" to JSONArray(coords),
                                            "minutes" to minutes,
                                            "distance" to path.optDouble("distance"),
                                        )
                                    val summary =
                                        "约 ${kotlin.math.ceil(minutes).toInt()} 分钟 · ${path.optInt("distance")} 米"
                                    onRouteResult(routeObj, summary)
                                }
                            }
                        ) {
                            Text("查看路线", maxLines = 1, softWrap = false)
                        }
                        if (routeText.isNotBlank()) Text(routeText)
                    }
                }
            }
        }
    }
}
