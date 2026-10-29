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
import org.maplibre.android.annotations.MarkerOptions
import org.maplibre.android.annotations.PolylineOptions
import org.maplibre.android.camera.CameraPosition
import org.maplibre.android.camera.CameraUpdateFactory
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.maps.MapView
import org.maplibre.android.maps.Style

private const val OSM_STYLE =
    """{"version":8,"sources":{"osm":{"type":"raster","tiles":["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],"tileSize":256,"maxzoom":19,"attribution":"© OpenStreetMap contributors"}},"layers":[{"id":"background","type":"background","paint":{"background-color":"#e5eee5"}},{"id":"osm","type":"raster","source":"osm"}]}"""

@Composable
fun NativeMapScreen(s: JourneyStore, onActivity: (JSONObject) -> Unit) {
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
    var mapReady by remember { mutableStateOf(false) }
    val favorites = s.objects("favorite").filter { it.s("state") == "active" }
    val activities =
        s.objects("activity").filter {
            it.s("state") == "active" && it.o("payload").optJSONObject("place") != null
        }
    val points = favorites.map { it.o("payload") } + activities.map { it.o("payload").o("place") }
    val currentPoints by rememberUpdatedState(points)
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
            map.setStyle(Style.Builder().fromJson(OSM_STYLE))
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
            map.setOnMarkerClickListener { marker ->
                selected = currentPoints.find { it.s("name") == marker.title }
                true
            }
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
    LaunchedEffect(nativeMap, points.map { it.toString() }, route?.toString()) {
        nativeMap?.let { map ->
            map.clear()
            points.forEach { p ->
                if (!p.isNull("lng") && !p.isNull("lat")) {
                    val ll = Coordinates.toWgs(p.optDouble("lng"), p.optDouble("lat"))
                    map.addMarker(
                        MarkerOptions().position(LatLng(ll.second, ll.first)).title(p.s("name"))
                    )
                }
            }
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
                            .color(android.graphics.Color.rgb(36, 107, 88))
                            .width(5f)
                    )
            }
        }
    }
    LaunchedEffect(selected?.toString()) {
        selected?.let { p ->
            if (!p.isNull("lng") && !p.isNull("lat")) {
                val ll = Coordinates.toWgs(p.optDouble("lng"), p.optDouble("lat"))
                nativeMap?.animateCamera(
                    CameraUpdateFactory.newLatLngZoom(LatLng(ll.second, ll.first), 15.0)
                )
            }
        }
    }
    Column(Modifier.fillMaxSize()) {
        Row(
            Modifier.padding(horizontal = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Field("搜索地点", query, { query = it }, Modifier.weight(1f))
            Button(
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
                    Row {
                        TextButton({
                            s.action { s.mutate("create", objectType = "favorite", patch = p) }
                        }) {
                            Text("收藏地点")
                        }
                        TextButton({ onActivity(p) }) { Text("加入行程") }
                        TextButton({
                            origin = p
                            route = null
                            routeText = ""
                        }) {
                            Text("从这里出发")
                        }
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
            Text("我的收藏", style = MaterialTheme.typography.titleMedium)
            if (favorites.isEmpty()) Text("搜索地点，或长按地图选择一个地方。")
            favorites.forEach { o ->
                Panel {
                    TextButton({ selected = o.o("payload") }) { Text(o.o("payload").s("name")) }
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
}
