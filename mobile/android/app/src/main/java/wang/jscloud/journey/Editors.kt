package wang.jscloud.journey

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import java.time.LocalDate
import java.time.temporal.ChronoUnit
import java.util.UUID
import kotlinx.coroutines.delay
import org.json.JSONArray
import org.json.JSONObject

@Composable
fun ActivitySheet(
    s: JourneyStore,
    existing: JSONObject?,
    initialPlace: JSONObject?,
    close: () -> Unit,
) {
    val key = "activity-${existing?.s("id")?:"new"}"
    val tripId = remember { s.tripId }
    val uid = remember { s.user?.s("id") }
    val initial = remember {
        existing?.o("payload")?.copyJson()
            ?: obj(
                "title" to "",
                "dayId" to s.selectedDay,
                "order" to
                    ((s.objects("activity").maxOfOrNull { it.o("payload").optDouble("order", 0.0) }
                        ?: 0.0) + 1024),
                "time" to
                    obj(
                        "mode" to "flexible",
                        "period" to "",
                        "start" to null,
                        "end" to null,
                        "endDayOffset" to 0,
                    ),
                "place" to initialPlace,
                "buffers" to obj("before" to null, "after" to null),
                "notes" to "",
                "url" to "",
            )
    }
    var data by remember { mutableStateOf(initial.copyJson()) }
    val dirty = remember { mutableStateListOf<String>().apply {
        if (existing == null && initialPlace != null) add("place")
    } }
    var oldDraft by remember { mutableStateOf(s.draft(key)) }
    var draftReady by remember { mutableStateOf(oldDraft == null) }
    fun set(group: String, value: Any?) {
        data = data.copyJson().put(group, value ?: JSONObject.NULL)
        if (group !in dirty) dirty.add(group)
    }
    var session by remember { mutableStateOf(EditorSession(s, key, "activity", existing, oldDraft)) }
    val latest = s.objects("activity").find { it.s("id") == session.objectId }
    LaunchedEffect(latest?.toString()) {
        latest?.o("payload")?.let { p ->
            val n = data.copyJson()
            p.keys().forEach { if (it !in dirty) n.put(it, p.get(it)) }
            data = n
        }
    }
    val valid = data.s("title").isNotBlank() && data.s("title").trim().length <= 240 && data.s("dayId").isNotBlank() &&
        listOf("before", "after").all { data.o("buffers").isNull(it) || data.o("buffers").optDouble(it) >= 0 } &&
        (data.s("url").isBlank() || runCatching { java.net.URI(data.s("url")).let {
            it.isAbsolute && it.scheme.lowercase() in listOf("https", "http") && !it.host.isNullOrBlank()
        } }.getOrDefault(false)) &&
        (data.o("time").s("end").isBlank() || data.o("time").optInt("endDayOffset") > 0 ||
            data.o("time").s("end") >= data.o("time").s("start")) &&
        (data.o("time").s("mode") != "precise" ||
            runCatching { java.time.LocalTime.parse(data.o("time").s("start")) }.isSuccess) &&
        (data.o("time").s("end").isBlank() ||
            runCatching { java.time.LocalTime.parse(data.o("time").s("end")) }.isSuccess)
    fun persist(done: (() -> Unit)? = null) {
        if (draftReady) session.save(obj("payload" to data.copyJson()),
            if (valid) data.copyJson() else null, dirty.toList(), done) { savedDraft, fields ->
                fields.forEach { field ->
                    if (data.opt(field)?.toString() == savedDraft.o("payload").opt(field)?.toString()) dirty.remove(field)
                }
            } else done?.invoke()
    }
    LaunchedEffect(data.toString(), draftReady) {
        if (draftReady && dirty.isNotEmpty()) {
            // Draft persistence is immediate; publishing waits until typing pauses.
            session.save(obj("payload" to data.copyJson()), null, dirty.toList())
            delay(500)
            persist()
        }
    }
    var query by remember { mutableStateOf("") }
    var results by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    Sheet(if (existing == null) "添加活动" else "编辑活动", { persist(close) },
        onDone = { persist(close) }, doneEnabled = draftReady && valid) {
        EditorSaveStatus(s, valid)
        if (oldDraft != null)
            Panel {
                Text("发现上次未完成的输入")
                Row {
                    TextButton({
                        val restoredFields = editorDraftFields(oldDraft!!)
                        data = restoreEditorDraft(data, oldDraft!!)
                        restoredFields.forEach { if (it !in dirty) dirty.add(it) }
                        oldDraft = null
                        draftReady = true
                    }) {
                        Text("恢复输入")
                    }
                    TextButton({
                        session = EditorSession(s, key, "activity", existing, null)
                        s.launch { s.clearEditorDraft(key) }
                        oldDraft = null
                        draftReady = true
                    }) {
                        Text("使用当前内容")
                    }
                }
            }
        Field("活动名称", data.s("title"), { set("title", it) })
        val days = s.objects("day").filter { it.s("state") == "active" }
        val labels =
            days.associate {
                it.s("id") to it.o("payload").s("date", "第 ${it.o("payload").optInt("ordinal")} 天")
            }
        Choice("安排日期", labels[data.s("dayId")].orEmpty(), labels.values.toList()) { v ->
            set("dayId", labels.entries.first { it.value == v }.key)
        }
        val t = data.o("time")
        Choice("时间", if (t.s("mode") == "precise") "精确时间" else "灵活时间", listOf("灵活时间", "精确时间")) { v
            ->
            set(
                "time",
                t.copyJson().put("mode", if (v == "精确时间") "precise" else "flexible").apply {
                    if (v == "灵活时间") {
                        put("start", JSONObject.NULL)
                        put("end", JSONObject.NULL)
                        put("endDayOffset", 0)
                    }
                },
            )
        }
        if (t.s("mode") == "flexible")
            Choice("时段", t.s("period").ifBlank { "暂不设置" },
                listOf("暂不设置", "清晨", "上午", "中午", "下午", "晚上", "深夜")) {
                set("time", t.copyJson().put("period", if (it == "暂不设置") "" else it))
            }
        else {
            TimeField(
                "开始时间",
                t.s("start"),
                { set("time", t.copyJson().put("start", it.ifBlank { null } ?: JSONObject.NULL)) },
            )
            TimeField(
                "结束时间",
                t.s("end"),
                { set("time", t.copyJson().put("end", it.ifBlank { null } ?: JSONObject.NULL)) },
                optional = true,
            )
            Choice("结束日期", t.optInt("endDayOffset").toString(), (0..7).map { it.toString() }) {
                set("time", t.copyJson().put("endDayOffset", it.toInt()))
            }
        }
        val place = data.optJSONObject("place")
        if (place != null)
            Panel {
                Text(place.s("name"))
                Text(place.s("address"))
                TextButton({ set("place", null) }) { Text("移除地点") }
            }
        PlaceSearchField(query, { query = it }) {
            s.action { results = s.api.search(query, s.snapshot?.o("trip")?.s("destination").orEmpty()) }
        }
        results.take(6).forEach { p ->
            TextButton({
                set("place", p)
                results = emptyList()
                query = ""
            }) {
                Text(p.s("name") + " · " + p.s("address"))
            }
        }
        val buffers = data.o("buffers")
        Field(
            "活动前预留分钟（可不填）",
            buffers.s("before"),
            { v ->
                if (v.isEmpty() || v.toDoubleOrNull() != null)
                    set(
                        "buffers",
                        buffers.copyJson().put("before", v.toDoubleOrNull() ?: JSONObject.NULL),
                    )
            },
        )
        Field(
            "活动后预留分钟（可不填）",
            buffers.s("after"),
            { v ->
                if (v.isEmpty() || v.toDoubleOrNull() != null)
                    set(
                        "buffers",
                        buffers.copyJson().put("after", v.toDoubleOrNull() ?: JSONObject.NULL),
                    )
            },
        )
        Field("备注", data.s("notes"), { set("notes", it) }, single = false)
        Field("相关链接", data.s("url"), { set("url", it) })

    }
}

@Composable
fun ExpenseSheet(s: JourneyStore, existing: JSONObject?, close: () -> Unit) {
    val key = "expense-${existing?.s("id")?:"new"}"
    val tripId = remember { s.tripId }
    val uid = remember { s.user?.s("id") }
    val initial = remember {
        existing?.o("payload")?.copyJson()
            ?: obj(
                "title" to "",
                "date" to null,
                "payment" to
                    obj(
                        "status" to "estimated",
                        "amountMinor" to null,
                        "currency" to (s.snapshot?.o("trip")?.s("currency") ?: "CNY"),
                    ),
                "notes" to "",
                "activityId" to null,
            )
    }
    var data by remember { mutableStateOf(initial.copyJson()) }
    var amount by remember {
        mutableStateOf(
            initial.o("payment").let {
                if (it.isNull("amountMinor")) ""
                else
                    java.math.BigDecimal.valueOf(
                            it.optLong("amountMinor"),
                            currencyScale(it.s("currency")),
                        )
                        .toPlainString()
            }
        )
    }
    val dirty = remember { mutableStateListOf<String>() }
    var oldDraft by remember { mutableStateOf(s.draft(key)) }
    var draftReady by remember { mutableStateOf(oldDraft == null) }
    fun set(group: String, value: Any?) {
        data = data.copyJson().put(group, value ?: JSONObject.NULL)
        if (group !in dirty) dirty.add(group)
    }
    var session by remember { mutableStateOf(EditorSession(s, key, "expense", existing, oldDraft)) }
    val latest = s.objects("expense").find { it.s("id") == session.objectId }
    LaunchedEffect(latest?.toString()) {
        latest?.o("payload")?.let { p ->
            val n = data.copyJson()
            p.keys().forEach { if (it !in dirty) n.put(it, p.get(it)) }
            data = n
            if ("payment" !in dirty)
                amount =
                    p.o("payment").let {
                        if (it.isNull("amountMinor")) ""
                        else
                            java.math.BigDecimal.valueOf(
                                    it.optLong("amountMinor"),
                                    currencyScale(it.s("currency")),
                                )
                                .toPlainString()
                    }
        }
    }
    val payload = runCatching {
        data.copyJson().apply {
            val payment = o("payment")
            val minor = parseMinor(amount, payment.s("currency"))
            require(payment.s("status") != "paid" || minor != null)
            payment.put("amountMinor", minor ?: JSONObject.NULL)
            if (s("date").isNotBlank()) LocalDate.parse(s("date"))
        }
    }.getOrNull()
    val valid = expenseCanPublish(payload, session.hasObject, amount)
    fun persist(done: (() -> Unit)? = null) {
        if (draftReady) session.save(obj("payload" to data.copyJson(), "amountText" to amount),
            if (valid) payload else null, dirty.toList(), done) { savedDraft, fields ->
                fields.forEach { field ->
                    if (data.opt(field)?.toString() == savedDraft.o("payload").opt(field)?.toString() &&
                        (field != "payment" || amount == savedDraft.s("amountText"))) dirty.remove(field)
                }
            } else done?.invoke()
    }
    LaunchedEffect(data.toString(), amount, draftReady) {
        if (draftReady && dirty.isNotEmpty()) {
            session.save(obj("payload" to data.copyJson(), "amountText" to amount), null, dirty.toList())
            delay(500)
            persist()
        }
    }
    Sheet(if (existing == null) "添加费用" else "编辑费用", { persist(close) },
        onDone = { persist(close) }, doneEnabled = draftReady && valid) {
        EditorSaveStatus(s, valid)
        if (oldDraft != null)
            Panel {
                Text("发现上次未完成的输入")
                Row {
                    TextButton({
                        val restoredFields = editorDraftFields(oldDraft!!)
                        data = restoreEditorDraft(data, oldDraft!!)
                        restoredFields.forEach { if (it !in dirty) dirty.add(it) }
                        if ("payment" in restoredFields) amount = oldDraft!!.s("amountText")
                        oldDraft = null
                        draftReady = true
                    }) {
                        Text("恢复输入")
                    }
                    TextButton({
                        session = EditorSession(s, key, "expense", existing, null)
                        s.launch { s.clearEditorDraft(key) }
                        oldDraft = null
                        draftReady = true
                    }) {
                        Text("使用当前内容")
                    }
                }
            }
        Field("费用名称（可不填）", data.s("title"), { set("title", it) })
        val payment = data.o("payment")
        Choice("支付状态", if (payment.s("status") == "paid") "已支付" else "预计", listOf("预计", "已支付")) {
            set(
                "payment",
                payment.copyJson().put("status", if (it == "已支付") "paid" else "estimated"),
            )
        }
        Field(
            "金额",
            amount,
            {
                amount = it
                if ("payment" !in dirty) dirty.add("payment")
            },
        )
        Field(
            "币种",
            payment.s("currency"),
            { set("payment", payment.copyJson().put("currency", it.uppercase())) },
        )
        DateField("日期", data.s("date"), { set("date", it.ifBlank { null }) }, optional = true)
        Field("备注", data.s("notes"), { set("notes", it) }, single = false)
        val activities =
            s.objects("activity").associate { it.s("id") to it.o("payload").s("title") }
        Choice(
            "关联活动",
            activities[data.s("activityId")] ?: "不关联",
            listOf("不关联") + activities.values.toList(),
        ) { v ->
            set(
                "activityId",
                if (v == "不关联") null else activities.entries.first { it.value == v }.key,
            )
        }

    }
}

@Composable
fun LedgerScreen(s: JourneyStore, edit: (JSONObject?) -> Unit) {
    Heading("费用")
    val rows = s.objects("expense")
    val active = rows.filter { it.s("state") == "active" }
    active
        .groupBy { it.o("payload").o("payment").s("currency") }
        .forEach { (code, items) ->
            val paid =
                items
                    .filter { it.o("payload").o("payment").s("status") == "paid" }
                    .sumOf { it.o("payload").o("payment").optLong("amountMinor") }
            val estimated =
                items
                    .filter { it.o("payload").o("payment").s("status") == "estimated" }
                    .sumOf { it.o("payload").o("payment").optLong("amountMinor") }
            if (paid != 0L || estimated != 0L) Panel {
                if (paid != 0L) Text("已支付  " + money(paid, code), style = MaterialTheme.typography.headlineSmall)
                if (estimated != 0L) Text("预计  " + money(estimated, code))
                val missing = items.count { it.o("payload").o("payment").isNull("amountMinor") }
                if (missing > 0) Text("$missing 笔待定金额")
            }
        }
    Button({ edit(null) }) { Text("添加费用") }
    if (rows.isEmpty()) Panel { Text("还没有费用记录") }
    var previousDate: String? = null
    rows.sortedBy { it.o("payload").s("date").ifBlank { "9999" } }.forEach { o ->
        val p = o.o("payload")
        val date = p.s("date").ifBlank { "日期未记录" }
        if (date != previousDate) Text(date, style = MaterialTheme.typography.titleSmall)
        previousDate = date
        val payment = p.o("payment")
        Panel {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(p.s("title").ifBlank { "未命名费用" }, style = MaterialTheme.typography.titleMedium,
                    modifier = Modifier.weight(1f))
                Text(if (payment.isNull("amountMinor")) "金额待定"
                    else money(payment.optLong("amountMinor"), payment.s("currency")),
                    style = MaterialTheme.typography.titleMedium.copy(fontFeatureSettings = "tnum"))
            }
            Text(if (payment.s("status") == "paid") "已支付" else "预计",
                style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (p.s("notes").isNotBlank()) Text(p.s("notes"), maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
            s.objects("activity")
                .find { it.s("id") == p.s("activityId") }
                ?.let { Text("关联：" + it.o("payload").s("title")) }
            ObjectActions(s, o, onEdit = { edit(o) })
        }
    }
}

@Composable
fun ScheduleSheet(s: JourneyStore, close: () -> Unit) {
    val trip = s.snapshot?.o("trip") ?: return
    var start by remember { mutableStateOf(trip.s("startDate")) }
    var end by remember {
        mutableStateOf(
            if (start.isNotBlank())
                LocalDate.parse(start).plusDays(trip.optInt("dayCount").toLong() - 1).toString()
            else ""
        )
    }
    var move by remember { mutableStateOf(false) }
    Sheet("调整旅程日期", close) {
        DateField("开始日期", start, { start = it })
        DateField("结束日期", end, { end = it })
        Row {
            Checkbox(move, { move = it })
            Text("活动跟随原来的第几天移动")
        }
        Button({
            s.action {
                val a = LocalDate.parse(start)
                val n = ChronoUnit.DAYS.between(a, LocalDate.parse(end)) + 1
                require(n in 1..365) { "日期范围需为 1–365 天" }
                val days = s.objects("day").associateBy { it.s("id") }
                val moves =
                    if (move)
                        s.objects("activity").mapNotNull { o ->
                            val ordinal =
                                days[o.o("payload").s("dayId")]?.o("payload")?.optInt("ordinal")
                                    ?: return@mapNotNull null
                            obj(
                                "activityId" to o.s("id"),
                                "date" to a.plusDays(ordinal.toLong() - 1).toString(),
                                "ordinal" to ordinal,
                            )
                        }
                    else emptyList()
                s.mutate(
                    "reschedule",
                    trip.s("id"),
                    patch =
                        obj(
                            "startDate" to a.toString(),
                            "dayCount" to n,
                            "moves" to JSONArray(moves),
                        ),
                )
                close()
            }
        }) {
            Text("保存日期")
        }
    }
}
