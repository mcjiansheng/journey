package wang.jscloud.journey

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.text.input.KeyboardType
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
    val link = remember(data.s("url")) { normalizeActivityLink(data.s("url")) }
    val linkFocus = remember { FocusRequester() }
    var showLinkError by remember { mutableStateOf(false) }
    val linkError = if (showLinkError) link.exceptionOrNull()?.message else null
    val valid = data.s("title").isNotBlank() && data.s("title").trim().length <= 240 && data.s("dayId").isNotBlank() &&
        listOf("before", "after").all { data.o("buffers").isNull(it) || data.o("buffers").optDouble(it) >= 0 } &&
        (data.o("time").s("end").isBlank() || data.o("time").optInt("endDayOffset") > 0 ||
            data.o("time").s("end") >= data.o("time").s("start")) &&
        (data.o("time").s("mode") != "precise" ||
            runCatching { java.time.LocalTime.parse(data.o("time").s("start")) }.isSuccess) &&
        (data.o("time").s("end").isBlank() ||
            runCatching { java.time.LocalTime.parse(data.o("time").s("end")) }.isSuccess)
    fun persist(done: (() -> Unit)? = null) {
        if (draftReady) session.save(obj("payload" to data.copyJson()),
            if (valid) link.getOrNull()?.let { data.copyJson().put("url", it) } else null, dirty.toList(), done) { savedDraft, fields ->
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
        onDone = {
            if (link.isFailure) {
                showLinkError = true
                linkFocus.requestFocus()
            } else persist(close)
        }, doneEnabled = draftReady && valid) {
        EditorSaveStatus(s, valid && link.isSuccess)
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
        OutlinedTextField(
            value = data.s("url"),
            onValueChange = { set("url", it) },
            label = { Text("相关链接") },
            modifier = Modifier.fillMaxWidth().focusRequester(linkFocus),
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
            shape = RoundedCornerShape(14.dp),
            isError = linkError != null,
            supportingText = linkError?.let { message -> { Text(message) } },
        )

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
        val expenseObjects = s.objects("activity") + s.objects("day")
        DateField("费用日期", expenseDate(expenseObjects, data), { set("date", it.ifBlank { null }) })
        if (linkedExpenseActivity(expenseObjects, data) != null) {
            if (data.s("date").isBlank() && expenseDate(expenseObjects, data).isNotBlank()) {
                Text("已按活动所在日填写", style = MaterialTheme.typography.bodySmall)
                val today = LocalDate.now(java.time.ZoneId.of(s.snapshot?.o("trip")?.s("timezone") ?: "Asia/Shanghai"))
                TextButton({ set("date", today.toString()) }) { Text("改为付款当天（${today.format(java.time.format.DateTimeFormatter.ofPattern("MM/dd"))}）") }
            } else if (data.s("date").isNotBlank()) TextButton({ set("date", null) }) { Text("跟随活动日期") }
        } else if (data.s("date").isNotBlank()) TextButton({ set("date", null) }) { Text("清除日期") }
        Field("备注", data.s("notes"), { set("notes", it) }, single = false)
        val activities =
            s.objects("activity").filter { it.s("state") == "active" }.associate { it.s("id") to it.o("payload").s("title") }
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
fun LedgerScreen(s: JourneyStore, edit: (JSONObject?) -> Unit, onViewActivity: (JSONObject) -> Unit) {
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
    val objects = s.objects("activity") + s.objects("day")
    var previousDate: String? = null
    active.sortedBy { expenseDate(objects, it.o("payload")).ifBlank { "9999" } }.forEach { o ->
        val p = o.o("payload")
        val date = expenseDateLabel(s.snapshot!!.o("trip"), expenseDate(objects, p))
        if (date != previousDate) Text(date, style = MaterialTheme.typography.titleSmall)
        previousDate = date
        val payment = p.o("payment")
        Panel {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(expenseTitle(objects, p), style = MaterialTheme.typography.titleMedium,
                    modifier = Modifier.weight(1f))
                Text(if (payment.isNull("amountMinor")) "金额待定"
                    else money(payment.optLong("amountMinor"), payment.s("currency")),
                    style = MaterialTheme.typography.titleMedium.copy(fontFeatureSettings = "tnum"))
            }
            Text(if (payment.s("status") == "paid") "已支付" else "预计",
                style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (p.s("notes").isNotBlank()) Text(p.s("notes"), maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
            if (p.s("activityId").isNotBlank()) {
                val activity = linkedExpenseActivity(objects, p)
                if (activity != null) TextButton({ onViewActivity(activity) }) {
                    Text("↗ " + expenseActivityLabel(activity) + " ›")
                } else Text("关联活动已删除", style = MaterialTheme.typography.bodySmall)
            }
            ObjectActions(s, o, onEdit = { edit(o) })
        }
    }
}

@Composable
fun ScheduleSheet(s: JourneyStore, close: () -> Unit) {
    val trip = s.snapshot?.o("trip") ?: return
    var start by remember { mutableStateOf(trip.s("startDate")) }
    var end by remember { mutableStateOf(if (start.isNotBlank()) LocalDate.parse(start).plusDays(trip.optInt("dayCount").toLong() - 1).toString() else "") }
    var reviewing by remember { mutableStateOf(false) }
    var choice by remember { mutableStateOf("move") }
    val individual = remember { mutableStateMapOf<String, Int>() }
    val days = s.objects("day").associateBy { it.s("id") }
    val activities = s.objects("activity").filter { it.s("state") == "active" }
    val a = runCatching { LocalDate.parse(start) }.getOrNull()
    val z = runCatching { LocalDate.parse(end) }.getOrNull()
    val n = if (a != null && z != null) ChronoUnit.DAYS.between(a, z).toInt() + 1 else 0
    val shifted = start != trip.s("startDate")
    fun ordinal(o: JSONObject): Int? {
        val day = days[o.o("payload").s("dayId")]?.o("payload") ?: return null
        val old = trip.s("startDate"); val date = day.s("date")
        if (old.isBlank() != date.isBlank()) return null
        val index = if (old.isBlank()) day.optInt("ordinal") else ChronoUnit.DAYS.between(LocalDate.parse(old), LocalDate.parse(date)).toInt() + 1
        return index.takeIf { it in 1..trip.optInt("dayCount") }
    }
    val affected = activities.filter { ordinal(it)?.let { index -> shifted || index > n } == true }
    fun target(o: JSONObject): Int? = when (choice) {
        "keep" -> null
        "individual" -> individual[o.s("id")]
        else -> ordinal(o)?.let { minOf(it, n) }
    }
    Sheet("调整日期与天数", close) {
        TripRangeCalendar(start, end, trip.s("startDate"), trip.optInt("dayCount")) { a, b -> start = a; end = b; reviewing = false }
        Text("$start – $end · $n 天")
        Text("原来 ${trip.s("startDate")} · ${trip.optInt("dayCount")} 天")
        if (reviewing) {
            Text("已有安排怎么办", style = MaterialTheme.typography.titleMedium)
            listOf("move" to if (shifted) "跟着一起移动" else "移到最后一天", "keep" to if (shifted) "留在原来的日期" else "放进行程外安排", "individual" to "逐项选择…").forEach { (value, title) ->
                Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                    RadioButton(choice == value, { choice = value }); TextButton({ choice = value }) { Text(title) }
                }
            }
            (if (choice == "individual") affected else affected.take(3)).forEach { o ->
                val target = target(o)
                Text(o.o("payload").s("title"))
                Text("${days[o.o("payload").s("dayId")]?.o("payload")?.s("date")} → ${if (target != null && a != null) a.plusDays(target.toLong() - 1) else "保留原日期"}")
                if (choice == "individual") SearchableSetupChoice("移到", individual[o.s("id")]?.let { "第 $it 天" } ?: "保留原日期", linkedMapOf("0" to "保留原日期").apply { (1..n.coerceIn(1,365)).forEach { put(it.toString(), "第 $it 天") } }) { value ->
                    if (value == "0") individual.remove(o.s("id")) else individual[o.s("id")] = value.toInt()
                }
            }
        }
        Button({
            if (!reviewing && affected.isNotEmpty()) { choice = "move"; reviewing = true }
            else s.action {
                require(a != null && n in 1..365) { "日期范围需为 1–365 天" }
                val moves = activities.mapNotNull { o -> target(o)?.let { index -> obj("activityId" to o.s("id"), "date" to a.plusDays(index.toLong() - 1).toString(), "ordinal" to index) } }
                s.mutate("reschedule", trip.s("id"), patch = obj("startDate" to start, "dayCount" to n, "moves" to JSONArray(moves)))
                close()
            }
        }, enabled = a != null && n in 1..365) { Text(if (!reviewing && affected.isNotEmpty()) "下一步" else "完成") }
    }
}
