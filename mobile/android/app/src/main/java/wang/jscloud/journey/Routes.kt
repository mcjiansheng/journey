package wang.jscloud.journey

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import java.util.UUID
import kotlin.math.ceil
import org.json.JSONArray
import org.json.JSONObject

val routeNames =
    linkedMapOf("walking" to "步行", "driving" to "驾车", "bicycling" to "骑行", "transit" to "公交")

fun JourneyApi.estimateRoute(
    from: JSONObject,
    to: JSONObject,
    mode: String,
    city: String,
): JSONObject {
    require(!from.isNull("lng") && !to.isNull("lng")) { "请先为起点和终点选择地图地点" }
    val path =
        when (mode) {
            "bicycling" -> "/v4/direction/bicycling"
            "transit" -> "/v3/direction/transit/integrated"
            else -> "/v3/direction/$mode"
        }
    val result =
        request(
            "/_AMapService$path?origin=${from.optDouble("lng")},${from.optDouble("lat")}&destination=${to.optDouble("lng")},${to.optDouble("lat")}&city=${JourneyApi.encode(city)}&cityd=${JourneyApi.encode(city)}&extensions=all"
        )
    val route =
        (if (mode == "bicycling") result.o("data").a("paths")
            else if (mode == "transit") result.o("route").a("transits")
            else result.o("route").a("paths"))
            .rows()
            .firstOrNull() ?: throw IllegalStateException("暂时没有可用路线，请手动填写所需时间")
    val points = mutableListOf<JSONArray>()
    fun collect(value: Any?) {
        when (value) {
            is JSONObject ->
                value.keys().forEach { k ->
                    if (k == "polyline")
                        value.s(k).split(';').forEach { v ->
                            val ll = v.split(',')
                            val lng = ll.getOrNull(0)?.toDoubleOrNull()
                            val lat = ll.getOrNull(1)?.toDoubleOrNull()
                            if (lng != null && lat != null) points.add(JSONArray(listOf(lng, lat)))
                        }
                    else collect(value.opt(k))
                }
            is JSONArray -> (0 until value.length()).forEach { collect(value.opt(it)) }
        }
    }
    collect(route)
    return obj(
        "minutes" to ceil(route.optDouble("duration") / 60),
        "distance" to route.optDouble("distance"),
        "path" to JSONArray(points),
    )
}

@Composable
fun RouteLink(
    s: JourneyStore,
    from: JSONObject?,
    to: JSONObject,
    onEdit: (JSONObject?, JSONObject, JSONObject?) -> Unit,
    showEmpty: Boolean = false,
) {
    val routes =
        s.objects("route").filter {
            it.s("state") == "active" && it.o("payload").s("toId") == to.s("id")
        }
    val route =
        routes.firstOrNull { it.o("payload").s("fromId") == from?.s("id") } ?: routes.firstOrNull()
    if (route == null && !showEmpty) return
    TextButton({ onEdit(from, to, route) }, modifier = Modifier.fillMaxWidth()) {
        val p = route?.o("payload")
        val hasMinutes = p != null && !p.isNull("minutes")
        Text(
            if (p == null) "＋ 添加到这一站的路程"
            else
                (routeNames[p.s("mode")] ?: "") +
                    if (hasMinutes) " · 约 ${p!!.optDouble("minutes").toInt()} 分钟" else " · 时间待定"
        )
    }
}

@Composable
fun RouteSheet(
    s: JourneyStore,
    previous: JSONObject?,
    to: JSONObject,
    existing: JSONObject?,
    close: () -> Unit,
) {
    val draftKey = "route-${to.s("id")}"
    val draft = remember { s.draft(draftKey) }
    val initial = remember { draft?.optJSONObject("payload") ?: existing?.o("payload")?.copyJson() }
    val session = remember { EditorSession(s, draftKey, "route", existing, draft) }
    var touched by remember { mutableStateOf(draft != null) }
    val tripId = remember { s.tripId }
    val uid = remember { s.user?.s("id") }
    val options =
        s.objects("activity")
            .filter { it.s("state") == "active" && it.s("id") != to.s("id") }
            .map { it.s("id") to (it.o("payload").s("title") to it) } +
            s.objects("favorite")
                .filter { it.s("state") == "active" }
                .map {
                    "favorite-${it.s("id")}" to
                        ("收藏：" + it.o("payload").s("name") to
                            obj("id" to "origin", "payload" to obj("place" to it.o("payload"))))
                }
    var fromId by remember {
        mutableStateOf(
            initial?.s("fromId")?.ifBlank { null }
                ?: previous?.s("id")
                ?: options.firstOrNull()?.first.orEmpty()
        )
    }
    var independent by remember { mutableStateOf(initial?.optJSONObject("fromPlace")) }
    var mode by remember { mutableStateOf(initial?.s("mode") ?: "walking") }
    var minutes by remember { mutableStateOf(initial?.s("minutes").orEmpty()) }
    var manual by remember { mutableStateOf(initial?.optBoolean("manual") ?: true) }
    var estimate by remember { mutableStateOf<JSONObject?>(initial) }
    var estimateSignature by remember {
        mutableStateOf(
            if (initial?.optBoolean("manual") == false) initial.s("inputSignature") else null
        )
    }
    fun resolveFrom(key: String, place: JSONObject?): JSONObject? {
        if (place != null) return obj("id" to "origin", "payload" to obj("place" to place))
        return if (key.startsWith("favorite-"))
            s.objects("favorite")
                .find { it.s("id") == key.removePrefix("favorite-") }
                ?.let { obj("id" to "origin", "payload" to obj("place" to it.o("payload"))) }
        else s.objects("activity").find { it.s("id") == key }
    }
    fun currentTo() = s.objects("activity").find { it.s("id") == to.s("id") }
    val signature =
        resolveFrom(fromId, independent)?.let { from ->
            currentTo()?.let { routeSignature(from, it, mode) }
        }
    LaunchedEffect(signature, estimateSignature) {
        if (estimateSignature != null && estimateSignature != signature) {
            estimate = null
            estimateSignature = null
            minutes = ""
            manual = true
        }
    }
    val from = resolveFrom(fromId, independent)
    val target = currentTo()
    val payload = runCatching {
        require(from != null && target != null)
        val freshSignature = routeSignature(from, target, mode)
        require(manual || estimateSignature == freshSignature)
        val value = if (minutes.isBlank()) null else minutes.toDouble().also { require(it >= 0 && it.isFinite()) }
        val isOrigin = from.s("id") == "origin"
        obj("fromId" to if (isOrigin) null else from.s("id"),
            "fromPlace" to if (isOrigin) from.o("payload").o("place") else null,
            "toId" to target.s("id"), "mode" to mode, "minutes" to value,
            "manual" to manual, "inputSignature" to freshSignature,
            "path" to (estimate?.a("path") ?: JSONArray()), "distance" to estimate?.opt("distance"))
    }.getOrNull()
    val draftPayload = payload ?: obj("fromId" to fromId, "fromPlace" to independent,
        "mode" to mode, "minutes" to minutes, "manual" to manual,
        "inputSignature" to estimateSignature)
    val fields = listOf("fromId", "fromPlace", "toId", "mode", "minutes", "manual", "inputSignature", "path", "distance")
    fun persist(done: (() -> Unit)? = null) = session.save(obj("payload" to draftPayload),
        payload, if (touched) fields else emptyList(), done)
    LaunchedEffect(draftPayload.toString(), touched) {
        if (touched) {
            session.save(obj("payload" to draftPayload), null, fields)
            kotlinx.coroutines.delay(500)
            persist()
        }
    }
    Sheet("到 ${to.o("payload").s("title")} 的路程", { persist(close) },
        onDone = { persist(close) }, doneEnabled = payload != null) {
        EditorSaveStatus(s, payload != null)

        Choice(
            "从哪里出发",
            if (independent != null) independent!!.s("name")
            else options.find { it.first == fromId }?.second?.first.orEmpty(),
            options.map { it.second.first },
        ) { value ->
            touched = true
            fromId = options.first { it.second.first == value }.first
            independent = null
            estimate = null
            minutes = ""
            manual = true
            estimateSignature = null
        }
        Choice("交通方式", routeNames[mode] ?: "步行", routeNames.values.toList()) { value ->
            touched = true
            mode = routeNames.entries.first { it.value == value }.key
            estimate = null
            minutes = ""
            manual = true
            estimateSignature = null
        }
        Field(
            "所需分钟（可不填）",
            minutes,
            {
                touched = true
                minutes = it
                manual = true
                estimate = null
                estimateSignature = null
            },
        )
        SecondaryButton(
            {
                val queryFrom = fromId
                val queryPlace = independent?.copyJson()
                val queryMode = mode
                s.action {
                    val from =
                        resolveFrom(queryFrom, queryPlace) ?: throw IllegalStateException("请选择出发地点")
                    val target = currentTo() ?: throw IllegalStateException("终点活动已变化，请重新打开")
                    val expected = routeSignature(from, target, queryMode)
                    val result =
                        s.api.estimateRoute(
                            from.o("payload").o("place"),
                            target.o("payload").o("place"),
                            queryMode,
                            s.snapshot?.o("trip")?.s("destination").orEmpty(),
                        )
                    touched = true
                    minutes = result.s("minutes")
                    estimate = result
                    manual = false
                    estimateSignature = expected
                }
            },
            enabled = !s.busy,
        ) {
            Text("查询路程")
        }
        existing?.let { old ->
            s.objects("route").find { it.s("id") == old.s("id") }?.let { ObjectActions(s, it) }
        }
    }
}
