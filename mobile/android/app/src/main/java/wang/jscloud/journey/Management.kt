package wang.jscloud.journey

import android.content.Intent
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import org.json.JSONObject

@Composable
fun ManagementScreen(s: JourneyStore, onInvite: () -> Unit, onRename: () -> Unit) {
    val trip = s.snapshot?.o("trip") ?: return
    val members = s.snapshot?.a("members")?.rows() ?: emptyList()
    val me = members.find { it.s("userId") == s.user?.s("id") }
    val owner = trip.s("ownerId") == s.user?.s("id")
    val admin = owner || me?.optBoolean("isAdmin") == true
    var confirmLeave by remember { mutableStateOf(false) }
    var remove by remember { mutableStateOf<JSONObject?>(null) }
    Heading("旅程管理", trip.s("destination"))
    Panel {
        Text(trip.s("name"), style = MaterialTheme.typography.titleLarge)
        Text("${trip.s("startDate","日期待定")} · ${trip.optInt("dayCount")} 天")
        Text(trip.s("timezone"))
        TextButton(onRename) { Text("修改名称与目的地") }
        if (me?.optBoolean("canInvite") == true || admin)
            OutlinedButton(onInvite) { Text("邀请同行伙伴") }
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
    if (owner)
        Choice(
            "团队模式",
            if (trip.s("teamMode") == "equal") "平等协作" else "管理员管理",
            listOf("管理员管理", "平等协作"),
        ) { v ->
            s.action {
                s.management(
                    "/api/trips/${trip.s("id")}/team",
                    "PATCH",
                    obj("teamMode" to if (v == "平等协作") "equal" else "admin"),
                )
            }
        }
    val archived = s.trips.find { it.s("id") == trip.s("id") }?.optBoolean("archived") ?: false
    OutlinedButton(
        {
            s.action {
                s.management(
                    "/api/trips/${trip.s("id")}/archive",
                    body = obj("archived" to !archived),
                )
            }
        },
        modifier = Modifier.fillMaxWidth(),
    ) {
        Text(if (archived) "取消归档" else "归档到我的列表")
    }
    Panel {
        Text(if (trip.s("state") == "deleted") "旅程已删除" else "旅程状态")
        ObjectActions(s, trip.copyJson().put("kind", "trip"))
    }
    TextButton({ confirmLeave = true }) { Text("退出旅程", color = MaterialTheme.colorScheme.error) }
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
    var name by remember { mutableStateOf(trip.s("name")) }
    var destination by remember { mutableStateOf(trip.s("destination")) }
    Sheet("编辑旅程", close) {
        Field("旅程名称", name, { name = it })
        Field("目的地", destination, { destination = it })
        Button(
            {
                s.action {
                    val patch = JSONObject()
                    if (name != trip.s("name")) patch.put("name", name)
                    if (destination != trip.s("destination")) patch.put("destination", destination)
                    if (patch.length() > 0) s.mutate("patch", trip.s("id"), patch = patch)
                    close()
                }
            },
            enabled = name.isNotBlank(),
        ) {
            Text("保存")
        }
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
                Button({
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
fun ProfileSheet(s: JourneyStore, close: () -> Unit) {
    var name by remember { mutableStateOf(s.user?.s("displayName").orEmpty()) }
    var theme by remember {
        mutableStateOf(s.user?.o("preferences")?.s("theme", "system") ?: "system")
    }
    Sheet("个人设置", close) {
        Text(s.user?.s("identifier").orEmpty())
        Field("你的名字", name, { name = it })
        Choice(
            "外观",
            when (theme) {
                "dark" -> "深色"
                "light" -> "浅色"
                else -> "跟随系统"
            },
            listOf("跟随系统", "浅色", "深色"),
        ) {
            theme =
                when (it) {
                    "深色" -> "dark"
                    "浅色" -> "light"
                    else -> "system"
                }
        }
        Button(
            {
                s.action {
                    s.profile(name, obj("theme" to theme))
                    close()
                }
            },
            enabled = name.isNotBlank(),
        ) {
            Text("保存设置")
        }
        RecoveryPanel(s)
        TextButton({
            s.action {
                s.logout()
                close()
            }
        }) {
            Text("退出账号")
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
