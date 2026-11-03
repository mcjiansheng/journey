package wang.jscloud.journey

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import org.json.JSONArray
import org.json.JSONObject
import org.maplibre.android.MapLibre
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import org.maplibre.geojson.Feature
import org.maplibre.geojson.FeatureCollection
import org.maplibre.geojson.Point
import org.maplibre.android.style.sources.GeoJsonSource
import org.maplibre.android.style.layers.SymbolLayer
import org.maplibre.android.style.layers.PropertyFactory.*
import org.maplibre.android.style.expressions.Expression.*
import org.maplibre.android.annotations.PolylineOptions
import org.maplibre.android.camera.CameraPosition
import org.maplibre.android.camera.CameraUpdateFactory
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.maps.MapView
import org.maplibre.android.maps.Style

private const val OSM_STYLE =
    """{"version":8,"glyphs":"https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf","sources":{"osm":{"type":"raster","tiles":["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],"tileSize":256,"maxzoom":19,"attribution":"© OpenStreetMap contributors"}},"layers":[{"id":"background","type":"background","paint":{"background-color":"#EEF2EC"}},{"id":"osm","type":"raster","source":"osm"}]}"""

@Composable
fun NativeMapScreen(s: JourneyStore, onActivity: (JSONObject) -> Unit) {
    val routeColor = android.graphics.Color.parseColor(if (s.user?.o("preferences")?.s("palette") == "atlas") "#1f7fa3" else "#18786b")
    val ctx = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val mapTrip = remember { s.tripId }
    val mapUid = remember { s.user?.s("id") }
    val savedCamera = remember { s.draft("map-camera") }
    var nativeMap by remember { mutableStateOf<MapLibreMap?>(null) }
    val view = remember {
        MapLibre.getInstance(ctx)
        MapView(ctx).apply { onCreate(null) }
    }
    var selected by remember { mutableStateOf<JSONObject?>(null) }
    var query by remember { mutableStateOf("") }
    var results by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var origin by remember { mutableStateOf<JSONObject?>(null) }
    var mode by remember { mutableStateOf("步行") }
    var route by remember { mutableStateOf<JSONObject?>(null) }
    var routeText by remember { mutableStateOf("") }
    var mapError by remember { mutableStateOf("") }
    var groups by remember { mutableStateOf<List<List<JSONObject>>>(emptyList()) }
    var clusterList by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var markFilter by remember { mutableStateOf<String?>(null) }
    var managingPresets by remember { mutableStateOf(false) }
    var customizing by remember { mutableStateOf<JSONObject?>(null) }
    val defaultMark = obj("icon" to "circle", "color" to if (s.user?.o("preferences")?.s("palette") == "atlas") "blue" else "green")
    var lastMark by remember(s.tripId) { mutableStateOf(s.draft("last-favorite-mark") ?: defaultMark) }
    fun pointMark(p: JSONObject) = p.optJSONObject("mark") ?: defaultMark
    val presets = s.objects("markPreset").filter { it.s("state") == "active" }.sortedBy { it.o("payload").optDouble("order", 0.0) }
    fun presetName(p: JSONObject) = presets.firstOrNull { markKey(it.o("payload")) == markKey(pointMark(p)) }?.o("payload")?.s("name").orEmpty().ifBlank { "未命名" }
    var mapReady by remember { mutableStateOf(false) }
    val favorites = s.objects("favorite").filter { it.s("state") == "active" }
    val activities =
        s.objects("activity").filter {
            it.s("state") == "active" && it.o("payload").optJSONObject("place") != null
        }
    val points = favorites.filter { markFilter == null || markKey(pointMark(it.o("payload"))) == markFilter }.map { it.o("payload").copyJson().put("_id", it.s("id")).put("_priority", if (selected?.let { p -> sameMapPlace(p, it.o("payload")) } == true) 1 else 0) } + activities.mapIndexed { index, activity -> activity.o("payload").o("place").copyJson().put("_id", activity.s("id")).put("_priority", 1).put("_sequence", index + 1) }
    fun render(map: MapLibreMap) {
        val style = map.style ?: return
        val screenPoints = points.filter { !it.isNull("lng") && !it.isNull("lat") }.map { p ->
            val ll = Coordinates.toWgs(p.optDouble("lng"), p.optDouble("lat"))
            val screen = map.projection.toScreenLocation(LatLng(ll.second, ll.first))
            ClusterPoint(p.s("_id"), screen.x.toDouble(), screen.y.toDouble(), markKey(pointMark(p)), p.optInt("_priority"))
        }
        val lookup = points.associateBy { it.s("_id") }
        groups = clusterFavorites(screenPoints, groups.map { group -> group.map { it.s("_id") } }).map { ids -> ids.mapNotNull { lookup[it] } }
        val features = groups.mapIndexed { index, group ->
            val coordinates = group.map { Coordinates.toWgs(it.optDouble("lng"), it.optDouble("lat")) }
            val feature = Feature.fromGeometry(Point.fromLngLat(coordinates.map { it.first }.average(), coordinates.map { it.second }.average()))
            val marks = group.groupBy { markKey(pointMark(it)) }.values.sortedByDescending { it.size }.take(3)
            val image = Bitmap.createBitmap(if (marks.size > 1) 100 else 56, 56, Bitmap.Config.ARGB_8888)
            val canvas = Canvas(image)
            val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { textSize = 34f; typeface = android.graphics.Typeface.DEFAULT_BOLD }
            marks.forEachIndexed { markIndex, rows ->
                val mark = pointMark(rows[0]); val symbol = markIcons[mark.s("icon")] ?: "●"
                val x = 7f + markIndex * 20f
                paint.color = android.graphics.Color.WHITE; paint.style = Paint.Style.STROKE; paint.strokeWidth = 4f
                canvas.drawText(symbol, x, 40f, paint)
                paint.color = android.graphics.Color.parseColor(markColors[mark.s("color")] ?: "#176b88"); paint.style = Paint.Style.FILL
                canvas.drawText(symbol, x, 40f, paint)
            }
            if (group.size == 1 && group[0].has("_sequence")) {
                paint.color = routeColor; canvas.drawCircle(26f, 27f, 21f, paint)
                paint.color = android.graphics.Color.WHITE; paint.textSize = 24f; paint.textAlign = Paint.Align.CENTER; canvas.drawText(group[0].optInt("_sequence").toString(), 26f, 35f, paint); paint.textAlign = Paint.Align.LEFT
            }
            if (group.any { point -> activities.any { activity -> sameMapPlace(point, activity.o("payload").o("place")) } } && group[0].optInt("_sequence") == 0) { paint.color = android.graphics.Color.WHITE; canvas.drawCircle(image.width - 10f, 46f, 6f, paint); paint.color = routeColor; canvas.drawCircle(image.width - 10f, 46f, 4f, paint) }
            if (group.size > 1) { paint.textSize = 18f; paint.color = android.graphics.Color.WHITE; paint.style = Paint.Style.STROKE; paint.strokeWidth = 4f; canvas.drawText(group.size.toString(), image.width - 20f, 18f, paint); paint.style = Paint.Style.FILL; paint.color = android.graphics.Color.BLACK; canvas.drawText(group.size.toString(), image.width - 20f, 18f, paint) }
            val imageId = "favorite-group-$index"
            style.addImage(imageId, image)
            feature.addStringProperty("image", imageId)
            feature.addStringProperty("name", if (group.size == 1) group[0].s("name").let { it.take(8) + if (it.length > 8) "…" else "" } else if (marks.size == 1) presetName(group[0]).let { if (it == "未命名") "" else it } else "")
            feature.addNumberProperty("group", index)
            feature.addNumberProperty("priority", -group.maxOf { it.optInt("_priority") })
            feature
        }
        val collection = FeatureCollection.fromFeatures(features)
        val source = style.getSourceAs<GeoJsonSource>("journey-favorites")
        if (source == null) {
            style.addSource(GeoJsonSource("journey-favorites", collection))
            style.addLayer(SymbolLayer("journey-favorites", "journey-favorites").withProperties(iconImage(get("image")), iconAllowOverlap(true), textField(get("name")), textAllowOverlap(false), textOptional(true), textSize(13f), textOffset(arrayOf(1.6f, 0f)), textAnchor("left"), textColor(android.graphics.Color.BLACK), textHaloColor(android.graphics.Color.WHITE), textHaloWidth(2f), symbolSortKey(get("priority"))))
        } else source.setGeoJson(collection)
    }
    val redraw by rememberUpdatedState<(MapLibreMap) -> Unit>({ render(it) })
    val currentGroups by rememberUpdatedState(groups)
    DisposableEffect(view, lifecycle) {
        val observer = LifecycleEventObserver { _, e ->
            when (e) {
                Lifecycle.Event.ON_START -> view.onStart()
                Lifecycle.Event.ON_RESUME -> view.onResume()
                Lifecycle.Event.ON_PAUSE -> view.onPause()
                Lifecycle.Event.ON_STOP -> view.onStop()
                else -> Unit
            }
        }
        lifecycle.addObserver(observer)
        if (lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) view.onStart()
        if (lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) view.onResume()
        onDispose {
            nativeMap?.cameraPosition?.let { p ->
                val c =
                    obj("lat" to p.target?.latitude, "lng" to p.target?.longitude, "zoom" to p.zoom)
                s.launch { s.saveDraft("map-camera", c, mapTrip, mapUid) }
            }
            lifecycle.removeObserver(observer)
            view.onPause()
            view.onStop()
            view.onDestroy()
        }
    }
    LaunchedEffect(view) {
        view.addOnDidFailLoadingMapListener { mapError = it }
        view.addOnDidFinishRenderingMapListener { fully -> if (fully) mapReady = true }
        view.getMapAsync { map ->
            nativeMap = map
            map.setStyle(Style.Builder().fromJson(OSM_STYLE)) { redraw(map) }
            map.addOnCameraIdleListener { redraw(map) }
            map.addOnMapClickListener { ll ->
                val feature = map.queryRenderedFeatures(map.projection.toScreenLocation(ll), "journey-favorites").firstOrNull()
                val group = feature?.getNumberProperty("group")?.toInt()?.let { currentGroups.getOrNull(it) }
                if (group != null) {
                    if (group.size == 1) selected = group[0]
                    else {
                        val locations = group.map { p -> Coordinates.toWgs(p.optDouble("lng"), p.optDouble("lat")).let { LatLng(it.second, it.first) } }
                        val bounds = org.maplibre.android.geometry.LatLngBounds.Builder().includes(locations).build()
                        if (map.cameraPosition.zoom >= 18 || (bounds.latitudeSpan < 0.00005 && bounds.longitudeSpan < 0.00005)) clusterList = group
                        else map.animateCamera(CameraUpdateFactory.newLatLngBounds(bounds, 60))
                    }
                    true
                } else false
            }
            val p =
                savedCamera
                    ?: points
                        .firstOrNull { !it.isNull("lng") && !it.isNull("lat") }
                        ?.let {
                            Coordinates.toWgs(it.optDouble("lng"), it.optDouble("lat")).let { ll ->
                                obj("lng" to ll.first, "lat" to ll.second, "zoom" to 12)
                            }
                        }
                    ?: obj("lng" to 118.7969, "lat" to 32.0603, "zoom" to 11)
            map.cameraPosition =
                CameraPosition.Builder()
                    .target(LatLng(p.optDouble("lat"), p.optDouble("lng")))
                    .zoom(p.optDouble("zoom", 12.0))
                    .build()
            map.addOnMapLongClickListener { ll ->
                val gcj = Coordinates.toGcj(ll.longitude, ll.latitude)
                selected =
                    obj(
                        "name" to "地图选点",
                        "address" to "",
                        "lng" to gcj.first,
                        "lat" to gcj.second,
                        "provider" to null,
                        "providerPlaceId" to null,
                        "category" to "",
                        "sourceUrl" to "",
                        "fetchedAt" to System.currentTimeMillis(),
                        "coordSystem" to "GCJ-02",
                    )
                true
            }
        }
    }
    LaunchedEffect(nativeMap, points.map { it.toString() }, route?.toString(), routeColor) {
        nativeMap?.let { map ->
            map.clear()
            render(map)
            route?.a("path")?.let { path ->
                val coords =
                    (0 until path.length())
                        .map { path.getJSONArray(it) }
                        .map { v ->
                            Coordinates.toWgs(v.getDouble(0), v.getDouble(1)).let {
                                LatLng(it.second, it.first)
                            }
                        }
                if (coords.size > 1)
                    map.addPolyline(
                        PolylineOptions()
                            .addAll(coords)
                            .color(routeColor)
                            .width(5f)
                    )
            }
        }
    }
    val reducedMotion = LocalJourneyPalette.current.reducedMotion
    LaunchedEffect(selected?.toString()) {
        selected?.let { p ->
            if (!p.isNull("lng") && !p.isNull("lat")) {
                val ll = Coordinates.toWgs(p.optDouble("lng"), p.optDouble("lat"))
                val camera = CameraUpdateFactory.newLatLngZoom(LatLng(ll.second, ll.first), 15.0)
                if (reducedMotion) nativeMap?.moveCamera(camera) else nativeMap?.animateCamera(camera)
            }
        }
    }
    Column(Modifier.fillMaxSize()) {
        Row(
            Modifier.padding(horizontal = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Field("搜索地点", query, { query = it }, Modifier.weight(1f))
            SecondaryButton(
                {
                    s.action {
                        results =
                            s.api.search(query, s.snapshot?.o("trip")?.s("destination").orEmpty())
                    }
                },
                enabled = query.isNotBlank(),
                modifier = Modifier.padding(top = 8.dp),
            ) {
                Text("搜索")
            }
        }
        Box(Modifier.fillMaxWidth().weight(1f)) {
            AndroidView(
                { view },
                modifier =
                    Modifier.fillMaxSize()
                        .testTag(if (mapReady) "journey-map-ready" else "journey-map-loading"),
            )
            if (!mapReady) CircularProgressIndicator(Modifier.align(Alignment.Center))
        }
        TextButton(
            {
                ctx.startActivity(
                    Intent(Intent.ACTION_VIEW, Uri.parse("https://www.openstreetmap.org/copyright"))
                )
            },
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text("© OpenStreetMap contributors", style = MaterialTheme.typography.labelSmall)
        }
        Column(
            Modifier.fillMaxWidth()
                .heightIn(max = 300.dp)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            if (mapError.isNotEmpty())
                Text("地图加载失败：$mapError", color = MaterialTheme.colorScheme.error)
            if (results.isNotEmpty()) {
                results.forEach { p ->
                    TextButton({
                        selected = p
                        results = emptyList()
                    }) {
                        Text(p.s("name") + " · " + p.s("address"))
                    }
                }
            }
            selected?.let { p ->
                Panel {
                    Text(p.s("name"), style = MaterialTheme.typography.titleMedium)
                    if (p.s("address").isNotBlank()) Text(p.s("address"))
                    val currentFavorite = favorites.firstOrNull { it.s("id") == p.s("_id") || sameMapPlace(it.o("payload"), p) }
                    Row {
                        if (currentFavorite == null) TextButton({
                            s.action { val place = p.copyJson().apply { remove("_id"); remove("_priority"); remove("_sequence"); put("mark", lastMark) }; s.mutate("create", objectType = "favorite", patch = place) }
                        }) {
                            Text("收藏地点")
                        } else Text("已收藏")
                        TextButton({ onActivity(mapPlacePayload(p)) }) { Text("加入行程") }
                        TextButton({
                            origin = p
                            route = null
                            routeText = ""
                        }) {
                            Text("从这里出发")
                        }
                    }
                    currentFavorite?.let { favorite ->
                        Text("标记")
                        presets.forEach { preset -> TextButton({ s.action { val mark = obj("icon" to preset.o("payload").s("icon"), "color" to preset.o("payload").s("color")); s.mutate("patch", favorite.s("id"), patch = obj("mark" to mark)); lastMark = mark; s.saveDraft("last-favorite-mark", mark) } }) { Text(markTitle(preset.o("payload")) + " " + preset.o("payload").s("name").ifBlank { "未命名" }) } }
                        TextButton({ customizing = favorite }) { Text("自定义") }
                    }
                    if (origin != null) {
                        Text("从 ${origin!!.s("name")} 到这里")
                        Choice("交通", mode, listOf("步行", "驾车", "骑行")) { mode = it }
                        Button({
                            s.action {
                                require(!origin!!.isNull("lng") && !p.isNull("lng")) { "地点缺少坐标" }
                                val type =
                                    when (mode) {
                                        "驾车" -> "driving"
                                        "骑行" -> "bicycling"
                                        else -> "walking"
                                    }
                                val url =
                                    "/_AMapService/${if(type=="bicycling")"v4" else "v3"}/direction/$type?origin=${origin!!.optDouble("lng")},${origin!!.optDouble("lat")}&destination=${p.optDouble("lng")},${p.optDouble("lat")}&extensions=all"
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
                                route =
                                    obj(
                                        "path" to JSONArray(coords),
                                        "minutes" to minutes,
                                        "distance" to path.optDouble("distance"),
                                    )
                                routeText =
                                    "约 ${kotlin.math.ceil(minutes).toInt()} 分钟 · ${path.optInt("distance")} 米"
                            }
                        }) {
                            Text("查看路线")
                        }
                        if (routeText.isNotBlank()) Text(routeText)
                    }
                }
            }
            Row { TextButton({ managingPresets = true }) { Text("管理预设") } }
            favorites.groupBy { markKey(pointMark(it.o("payload"))) }.forEach { (key, rows) -> FilterChip(markFilter == key, { markFilter = if (markFilter == key) null else key }, label = { Text(markTitle(pointMark(rows[0].o("payload"))) + " " + presetName(rows[0].o("payload")) + " · ${rows.size}") }) }
            Text("我的收藏", style = MaterialTheme.typography.titleMedium)
            if (favorites.isEmpty()) Text("搜索地点，或长按地图选择一个地方。")
            favorites.forEach { o ->
                Panel {
                    TextButton({ selected = o.o("payload").copyJson().put("_id", o.s("id")) }) { Text(markTitle(pointMark(o.o("payload"))) + " " + o.o("payload").s("name")) }
                    ObjectActions(s, o)
                }
            }
            val deleted = s.objects("favorite").filter { it.s("state") == "deleted" }
            if (deleted.isNotEmpty()) Text("已删除收藏")
            deleted.forEach { o ->
                Panel {
                    Text(o.o("payload").s("name"))
                    ObjectActions(s, o)
                }
            }
            Spacer(Modifier.height(12.dp))
        }
    }
    if (managingPresets) MarkPresetManager(s) { managingPresets = false }
    customizing?.let { favorite -> MarkEditor(s, pointMark(favorite.o("payload")), favorite = favorite, close = { customizing = null }, applied = { lastMark = it; s.launch { s.saveDraft("last-favorite-mark", it) } }) }
    if (clusterList.isNotEmpty()) AlertDialog(
        onDismissRequest = { clusterList = emptyList() },
        title = { Text("${clusterList.size} 个收藏") },
        text = { Column { clusterList.forEach { point ->
            TextButton({ selected = point; clusterList = emptyList() }) {
                Text(markTitle(pointMark(point)) + " " + point.s("name") + " · " + presetName(point))
            }
        } } },
        confirmButton = { TextButton({ clusterList = emptyList() }) { Text("完成") } },
    )
}
