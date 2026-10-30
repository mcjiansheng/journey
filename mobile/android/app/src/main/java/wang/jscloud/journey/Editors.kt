package wang.jscloud.journey

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
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
    val dirty = remember { mutableStateListOf<String>() }
    var oldDraft by remember { mutableStateOf(s.draft(key)) }
    var draftReady by remember { mutableStateOf(oldDraft == null) }
    fun set(group: String, value: Any?) {
        data = data.copyJson().put(group, value ?: JSONObject.NULL)
        if (group !in dirty) dirty.add(group)
    }
    val latest = s.objects("activity").find { it.s("id") == existing?.s("id") }
    LaunchedEffect(latest?.toString()) {
        latest?.o("payload")?.let { p ->
            val n = data.copyJson()
            p.keys().forEach { if (it !in dirty) n.put(it, p.get(it)) }
            data = n
        }
    }
    LaunchedEffect(data.toString(), draftReady) {
        if (draftReady) {
            delay(300)
            val payload = data.copyJson()
            s.launch { s.saveDraft(key, obj("payload" to payload), tripId, uid) }
        }
    }
    var query by remember { mutableStateOf("") }
    var results by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    Sheet(if (existing == null) "添加活动" else "编辑活动", close) {
        if (oldDraft != null)
            Panel {
                Text("发现上次未完成的输入")
                Row {
                    TextButton({
                        data = oldDraft!!.o("payload").copyJson()
                        data.keys().forEach { if (it !in dirty) dirty.add(it) }
                        oldDraft = null
                        draftReady = true
                    }) {
                        Text("恢复输入")
                    }
                    TextButton({
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
            Field("时段，如 上午", t.s("period"), { set("time", t.copyJson().put("period", it)) })
        else {
            Field(
                "开始 HH:mm",
                t.s("start"),
                { set("time", t.copyJson().put("start", it.ifBlank { null } ?: JSONObject.NULL)) },
            )
            Field(
                "结束 HH:mm（可不填）",
                t.s("end"),
                { set("time", t.copyJson().put("end", it.ifBlank { null } ?: JSONObject.NULL)) },
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
        Field("搜索地点", query, { query = it })
        SecondaryButton(
            {
                s.action {
                    results = s.api.search(query, s.snapshot?.o("trip")?.s("destination").orEmpty())
                }
            },
            enabled = query.isNotBlank(),
        ) {
            Text("搜索")
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
        Button(
            {
                val captured = data.copyJson()
                s.action {
                    require(s.tripId == tripId && s.user?.s("id") == uid) { "当前旅程已变化，请重新打开编辑" }
                    val patch =
                        if (existing == null) captured
                        else JSONObject().apply { dirty.forEach { g -> put(g, captured.get(g)) } }
                    if (existing != null && patch.length() == 0) {
                        close()
                        return@action
                    }
                    s.mutate(
                        if (existing == null) "create" else "patch",
                        existing?.s("id") ?: UUID.randomUUID().toString(),
                        if (existing == null) "activity" else null,
                        patch,
                        clearDraft = key,
                    )
                    close()
                }
            },
            enabled =
                !s.busy &&
                    draftReady &&
                    data.s("title").isNotBlank() &&
                    data.s("dayId").isNotBlank(),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text("保存活动")
        }
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
    val latest = s.objects("expense").find { it.s("id") == existing?.s("id") }
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
    LaunchedEffect(data.toString(), amount, draftReady) {
        if (draftReady) {
            delay(300)
            val captured = obj("payload" to data.copyJson(), "amountText" to amount)
            s.launch { s.saveDraft(key, captured, tripId, uid) }
        }
    }
    Sheet(if (existing == null) "添加费用" else "编辑费用", close) {
        if (oldDraft != null)
            Panel {
                Text("发现上次未完成的输入")
                Row {
                    TextButton({
                        data = oldDraft!!.o("payload").copyJson()
                        amount = oldDraft!!.s("amountText")
                        data.keys().forEach { if (it !in dirty) dirty.add(it) }
                        oldDraft = null
                        draftReady = true
                    }) {
                        Text("恢复输入")
                    }
                    TextButton({
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
        Field("日期 YYYY-MM-DD（可不填）", data.s("date"), { set("date", it.ifBlank { null }) })
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
        Button(
            {
                val captured = data.copyJson()
                val text = amount
                s.action {
                    require(s.tripId == tripId && s.user?.s("id") == uid) { "当前旅程已变化，请重新打开编辑" }
                    val p = captured.o("payment")
                    val minor = parseMinor(text, p.s("currency"))
                    require(p.s("status") != "paid" || minor != null) { "请填写已支付金额" }
                    p.put("amountMinor", minor ?: JSONObject.NULL)
                    if (captured.s("date").isNotEmpty()) LocalDate.parse(captured.s("date"))
                    val patch =
                        if (existing == null) captured
                        else JSONObject().apply { dirty.forEach { g -> put(g, captured.get(g)) } }
                    if (existing != null && patch.length() == 0) {
                        close()
                        return@action
                    }
                    s.mutate(
                        if (existing == null) "create" else "patch",
                        existing?.s("id") ?: UUID.randomUUID().toString(),
                        if (existing == null) "expense" else null,
                        patch,
                        clearDraft = key,
                    )
                    close()
                }
            },
            enabled = !s.busy && draftReady,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text("保存费用")
        }
    }
}

@Composable
fun LedgerScreen(s: JourneyStore, edit: (JSONObject?) -> Unit) {
    Heading("旅途花费", "每一笔，一起记。")
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
            Panel {
                Text("已支付  " + money(paid, code), style = MaterialTheme.typography.headlineSmall)
                Text("预计  " + money(estimated, code))
                val missing = items.count { it.o("payload").o("payment").isNull("amountMinor") }
                if (missing > 0) Text("$missing 笔待定金额")
            }
        }
    Button({ edit(null) }) { Text("添加费用") }
    if (rows.isEmpty()) Panel { Text("还没有费用记录") }
    rows.forEach { o ->
        val p = o.o("payload")
        val payment = p.o("payment")
        Panel {
            Text(p.s("title").ifBlank { "未命名费用" }, style = MaterialTheme.typography.titleMedium)
            Text(
                if (payment.isNull("amountMinor")) "金额待定"
                else money(payment.optLong("amountMinor"), payment.s("currency"))
            )
            Text((if (payment.s("status") == "paid") "已支付" else "预计") + "  " + p.s("date"))
            if (p.s("notes").isNotBlank()) Text(p.s("notes"))
            s.objects("activity")
                .find { it.s("id") == p.s("activityId") }
                ?.let { Text("关联：" + it.o("payload").s("title")) }
            TextButton({ edit(o) }) { Text("编辑") }
            ObjectActions(s, o)
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
        Field("开始 YYYY-MM-DD", start, { start = it })
        Field("结束 YYYY-MM-DD", end, { end = it })
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
