package wang.jscloud.journey

import android.content.Intent
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.Alignment
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.platform.LocalContext
import org.json.JSONObject

@Composable
fun ManagementScreen(s: JourneyStore, onInvite: () -> Unit, onRename: () -> Unit, onSchedule: () -> Unit) {
    val trip = s.snapshot?.o("trip") ?: return
    val members = s.snapshot?.a("members")?.rows() ?: emptyList()
    val me = members.find { it.s("userId") == s.user?.s("id") }
    val owner = trip.s("ownerId") == s.user?.s("id")
    val admin = owner || me?.optBoolean("isAdmin") == true
    var confirmLeave by remember { mutableStateOf(false) }
    var archiveConfirm by remember { mutableStateOf(false) }
    var remove by remember { mutableStateOf<JSONObject?>(null) }
    // 与网页、iOS 一致：按“除自己以外的同伴”计数；只有自己时给出邀请提示
    val others = (members.size - 1).coerceAtLeast(0)
    Heading("旅程设置",
        if (others > 0) "修改会同步给其他 $others 位同伴"
        else "目前只有你一人。邀请同伴后，这里的修改会同步给他们")
    Text("基本信息", style = MaterialTheme.typography.titleMedium)
    Panel {
        TripInfoRow(s, "名称", "name")
        TripInfoRow(s, "目的地", "destination")
        val deviceZone = java.time.ZoneId.systemDefault().id
        val destinationZone = knownDestinationTimezone(trip.s("destination"))
        val zones = linkedMapOf<String, String>().apply {
            destinationZone?.let { put(it, timezoneLabel(it)) }
            put(deviceZone, timezoneLabel(deviceZone))
            java.time.ZoneId.getAvailableZoneIds().sorted().forEach { put(it, timezoneLabel(it)) }
        }
        SearchableSetupChoice("时区", timezoneLabel(trip.s("timezone")), zones, selectedId = trip.s("timezone")) { value -> s.action { s.mutate("patch", trip.s("id"), patch = obj("timezone" to value)) } }
    }
    Text("日程", style = MaterialTheme.typography.titleMedium)
    Panel { TextButton(onSchedule) { Text("日期  ${trip.s("startDate", "日期待定")} · ${trip.optInt("dayCount")} 天 ›") } }
    Text("成员与权限", style = MaterialTheme.typography.titleMedium)
    Panel {
        Text(if (members.size <= 1) "成员与邀请 · 仅你一人" else "成员与邀请 · ${members.size} 人")
        if (me?.optBoolean("canInvite") == true || admin) SecondaryButton(onInvite) { Text("邀请同行伙伴") }
    }
    Text("同行伙伴 · ${members.size}", style = MaterialTheme.typography.titleMedium)
    members.forEach { m ->
        Panel {
            Text(m.s("displayName"), style = MaterialTheme.typography.titleMedium)
            Text(
                if (m.s("userId") == trip.s("ownerId")) "创建者"
                else if (m.optBoolean("isAdmin")) "管理员" else "成员"
            )
            if (admin && m.s("userId") != trip.s("ownerId")) {
                Row {
                    TextButton({
                        s.action {
                            s.management(
                                "/api/trips/${trip.s("id")}/members/${m.s("userId")}",
                                "PATCH",
                                obj("isAdmin" to !m.optBoolean("isAdmin")),
                            )
                        }
                    }) {
                        Text(if (m.optBoolean("isAdmin")) "设为成员" else "设为管理员")
                    }
                    TextButton({
                        s.action {
                            s.management(
                                "/api/trips/${trip.s("id")}/members/${m.s("userId")}",
                                "PATCH",
                                obj("canInvite" to !m.optBoolean("canInvite")),
                            )
                        }
                    }) {
                        Text(if (m.optBoolean("canInvite")) "取消邀请权限" else "允许邀请")
                    }
                }
                TextButton({ remove = m }) { Text("移出团队", color = MaterialTheme.colorScheme.error) }
            }
        }
    }
    if (owner) TeamModeCards(trip.s("teamMode"), { mode ->
        s.action {
            s.management("/api/trips/${trip.s("id")}/team", "PATCH", obj("teamMode" to mode))
        }
    }, enabled = !s.busy)
    Text("整理", style = MaterialTheme.typography.titleMedium)
    val deleted = s.objects().filter { it.s("state") == "deleted" }
    Panel {
        Text("已删除的内容 · ${deleted.size}")
        deleted.forEach { o -> Text(o.o("payload").s("title").ifBlank { o.o("payload").s("name", "计划内容") }); ObjectActions(s, o) }
    }
    val archived = s.trips.find { it.s("id") == trip.s("id") }?.optBoolean("archived") ?: false
    SecondaryButton({ archiveConfirm = true }, modifier = Modifier.fillMaxWidth()) { Text(if (archived) "取消归档" else "归档旅程") }
    Text("从我的旅程列表收起，可随时取消", color = MaterialTheme.colorScheme.onSurfaceVariant)
    if (archiveConfirm) AlertDialog(onDismissRequest = { archiveConfirm = false }, title = { Text(if (archived) "取消归档？" else "归档旅程？") }, confirmButton = { TextButton({ s.action { s.management("/api/trips/${trip.s("id")}/archive", body = obj("archived" to !archived)); archiveConfirm = false } }) { Text("确认") } }, dismissButton = { TextButton({ archiveConfirm = false }) { Text("取消") } })
    if (owner) Panel {
        Text(if (trip.s("state") == "deleted") "旅程已删除" else "旅程状态")
        ObjectActions(s, trip.copyJson().put("kind", "trip"))
    }
    Text("想改主题色或提醒方式？点右上角头像打开我的设置。", color = MaterialTheme.colorScheme.onSurfaceVariant)
    TextButton({ confirmLeave = true }) { Text(if (members.size == 1) "退出并删除旅程" else "退出旅程", color = MaterialTheme.colorScheme.error) }
    if (confirmLeave)
        AlertDialog(
            onDismissRequest = { confirmLeave = false },
            title = { Text("退出这段旅程？") },
            text = {
                Text(if (members.size == 1) "你是最后一位成员，退出后旅程将永久清除。" else "退出后，你将无法继续查看和编辑旅程。")
            },
            confirmButton = {
                TextButton({
                    s.action {
                        s.leave(members.size == 1)
                        confirmLeave = false
                    }
                }) {
                    Text(if (members.size == 1) "退出并永久清除" else "退出旅程")
                }
            },
            dismissButton = { TextButton({ confirmLeave = false }) { Text("取消") } },
        )
    remove?.let { m ->
        AlertDialog(
            onDismissRequest = { remove = null },
            title = { Text("移出 ${m.s("displayName")}？") },
            confirmButton = {
                TextButton({
                    s.action {
                        s.management(
                            "/api/trips/${trip.s("id")}/members/${m.s("userId")}",
                            "DELETE",
                        )
                        remove = null
                    }
                }) {
                    Text("移出")
                }
            },
            dismissButton = { TextButton({ remove = null }) { Text("取消") } },
        )
    }
}

@Composable
fun RenameSheet(s: JourneyStore, close: () -> Unit) {
    val trip = s.snapshot?.o("trip") ?: return
    val key = "trip-info"
    val draft = remember { s.draft(key) }
    var name by remember { mutableStateOf(draft?.o("payload")?.s("name") ?: trip.s("name")) }
    var destination by remember { mutableStateOf(draft?.o("payload")?.s("destination") ?: trip.s("destination")) }
    val session = remember { EditorSession(s, key, "trip", obj("id" to trip.s("id"),
        "payload" to obj("name" to trip.s("name"), "destination" to trip.s("destination"))), draft) }
    val payload = obj("name" to name, "destination" to destination)
    val changed = remember { mutableStateListOf<String>() }
    fun persist(done: (() -> Unit)? = null) = session.save(obj("payload" to payload),
        if (name.isNotBlank() && destination.isNotBlank()) payload else null, changed.toList(), done)
    LaunchedEffect(name, destination) {
        if (changed.isNotEmpty()) {
            session.save(obj("payload" to payload), null, changed.toList())
            kotlinx.coroutines.delay(500)
            persist()
        }
    }
    Sheet("编辑旅程", { persist(close) }, onDone = { persist(close) },
        doneEnabled = name.isNotBlank() && destination.isNotBlank()) {
        EditorSaveStatus(s, name.isNotBlank() && destination.isNotBlank())
        Field("旅程名称", name, { name = it; if ("name" !in changed) changed.add("name") })
        Field("目的地", destination, { destination = it; if ("destination" !in changed) changed.add("destination") })
    }
}

@Composable
fun InvitesSheet(s: JourneyStore, close: () -> Unit) {
    val id = s.tripId ?: return
    val canManage =
        s.snapshot?.o("trip")?.s("ownerId") == s.user?.s("id") ||
            s.snapshot?.a("members")?.rows()?.any {
                it.s("userId") == s.user?.s("id") && it.optBoolean("isAdmin")
            } == true
    var invites by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var latest by remember { mutableStateOf<JSONObject?>(null) }
    var hours by remember { mutableStateOf("72") }
    val ctx = LocalContext.current
    LaunchedEffect(id) {
        if (canManage)
            s.launch { invites = s.api.request("/api/trips/$id/invites").a("invites").rows() }
    }
    Sheet("邀请同行伙伴", close) {
        Field("有效小时数", hours, { hours = it })
        Button({
            s.action {
                latest =
                    s.api.request(
                        "/api/trips/$id/invites",
                        "POST",
                        obj("expiresInHours" to hours.toInt()),
                    )
                if (canManage) invites = s.api.request("/api/trips/$id/invites").a("invites").rows()
            }
        }) {
            Text("生成邀请")
        }
        latest?.let { r ->
            Panel {
                Text(r.s("code"), style = MaterialTheme.typography.headlineSmall)
                Text(r.s("url"))
                SecondaryButton({
                    ctx.startActivity(
                        Intent.createChooser(
                            Intent(Intent.ACTION_SEND)
                                .setType("text/plain")
                                .putExtra(
                                    Intent.EXTRA_TEXT,
                                    "一起加入「${s.snapshot?.o("trip")?.s("name")}」：${r.s("url")}",
                                ),
                            "分享邀请",
                        )
                    )
                }) {
                    Text("分享邀请")
                }
            }
        }
        invites.forEach { i ->
            Panel {
                Text(
                    "有效期至 " +
                        java.text
                            .SimpleDateFormat("MM-dd HH:mm", java.util.Locale.CHINA)
                            .format(java.util.Date(i.optLong("expiresAt")))
                )
                if (i.isNull("revokedAt"))
                    TextButton({
                        s.action {
                            s.api.request("/api/trips/$id/invites/${i.s("id")}", "DELETE")
                            if (canManage)
                                invites =
                                    s.api.request("/api/trips/$id/invites").a("invites").rows()
                        }
                    }) {
                        Text("撤销邀请")
                    }
                else Text("已撤销")
            }
        }
    }
}

@Composable
fun RecoveryPanel(s: JourneyStore) {
    s.pending
        .groupBy { it.s("tripId") }
        .forEach { (id, queue) ->
            val first = queue.firstOrNull() ?: return@forEach
            if (
                first.s("blocked").isBlank() &&
                    !first.optBoolean("unknown") &&
                    !first.o("operation").o("clock").optBoolean("uncertain")
            )
                return@forEach
            var confirmation by
                remember(id, queue.map { it.o("operation").s("id") }) { mutableStateOf("") }
            val ids = queue.map { it.o("operation").s("id") }
            val unknown = queue.any { it.optBoolean("unknown") }
            val reapply =
                first.s("blocked") == "CLOCK_UNCERTAIN" ||
                    first.o("operation").o("clock").optBoolean("uncertain")
            Panel {
                Text(
                    if (unknown) "有修改等待确认" else if (reapply) "有离线修改等待重新应用" else "有修改未能提交",
                    style = MaterialTheme.typography.titleMedium,
                )
                Text("${s.trips.find{it.s("id")==id}?.s("name")?:"旅程"} · ${queue.size} 项")
                queue.forEach {
                    Text("· " + it.s("summary"), style = MaterialTheme.typography.bodySmall)
                }
                if (first.s("message").isNotBlank()) Text(first.s("message"))
                TextButton({ s.action { s.retry() } }) { Text("重试确认") }
                if (!unknown) {
                    Row {
                        if (reapply) TextButton({ confirmation = "reapply" }) { Text("重新应用") }
                        TextButton({ confirmation = "discard" }) { Text("放弃这些修改") }
                    }
                }
            }
            if (confirmation.isNotEmpty())
                AlertDialog(
                    onDismissRequest = { confirmation = "" },
                    title = {
                        Text(
                            if (confirmation == "reapply") "重新应用这 ${queue.size} 项修改？"
                            else "放弃这 ${queue.size} 项修改？"
                        )
                    },
                    text = {
                        Text(if (confirmation == "reapply") "这些修改将按当前时间重新提交。" else "未完成的输入仍保存在本机。")
                    },
                    confirmButton = {
                        TextButton({
                            val re = confirmation == "reapply"
                            s.action {
                                s.recover(id, re, ids)
                                confirmation = ""
                            }
                        }) {
                            Text("确认")
                        }
                    },
                    dismissButton = { TextButton({ confirmation = "" }) { Text("取消") } },
                )
        }
}

@Composable
fun TripInfoRow(s: JourneyStore, label: String, key: String) {
    val trip = s.snapshot?.o("trip") ?: return
    val tripId = trip.s("id")
    val accountId = s.user?.s("id")
    val draftKey = "trip-info-$key"
    var value by remember(tripId) { mutableStateOf(s.draft(draftKey)?.s("value") ?: trip.s(key)) }
    var focused by remember { mutableStateOf(false) }
    var dirty by remember { mutableStateOf(false) }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f))
        TextField(value, { value = it; dirty = true; s.launch { s.saveDraft(draftKey, obj("value" to it), tripId, accountId) } },
            modifier = Modifier.weight(2f).onFocusChanged { state ->
                if (focused && !state.isFocused && dirty && value.isNotBlank()) s.action {
                    check(s.tripId == tripId && s.user?.s("id") == accountId) { "旅程已切换，修改仍保存在草稿" }
                    s.mutate("patch", tripId, patch = obj(key to value), clearDraft = draftKey)
                    dirty = false
                }
                focused = state.isFocused
            }, singleLine = true, textStyle = MaterialTheme.typography.bodyLarge.copy(textAlign = TextAlign.End),
            colors = TextFieldDefaults.colors(focusedContainerColor = androidx.compose.ui.graphics.Color.Transparent, unfocusedContainerColor = androidx.compose.ui.graphics.Color.Transparent))
    }
}
