package wang.jscloud.journey

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import kotlin.math.abs
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.zIndex
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.ZoneId
import java.time.temporal.ChronoUnit
import org.json.JSONObject

class MainActivity : ComponentActivity() {
    private val store: JourneyStore by viewModels()

    override fun onStart() {
        super.onStart()
        store.setForeground(true)
    }

    override fun onStop() {
        store.setForeground(false)
        super.onStop()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            JourneyTheme(store) {
                JourneyApp(
                    store,
                    intent?.data?.getQueryParameter("invite") ?: intent?.data?.lastPathSegment,
                )
            }
        }
    }
}

@Composable
fun Field(
    label: String,
    value: String,
    onValue: (String) -> Unit,
    modifier: Modifier = Modifier,
    single: Boolean = true,
) {
    OutlinedTextField(
        value,
        onValue,
        label = { Text(label) },
        modifier = modifier.fillMaxWidth(),
        singleLine = single,
        shape = RoundedCornerShape(14.dp),
    )
}

@Composable
fun Choice(label: String, value: String, choices: List<String>, set: (String) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    Box {
        TextButton(onClick = { expanded = true }, modifier = Modifier.fillMaxWidth()) {
            Text(label, modifier = Modifier.weight(1f), color = MaterialTheme.colorScheme.onSurface)
            Text(value)
            Icon(Icons.Outlined.ExpandMore, null)
        }
        DropdownMenu(expanded, { expanded = false }) {
            choices.forEach {
                DropdownMenuItem(
                    text = { Text(it) },
                    onClick = {
                        set(it)
                        expanded = false
                    },
                )
            }
        }
    }
}

@Composable
fun Panel(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Card(
        modifier = modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = LocalJourneyPalette.current.card),
        border = BorderStroke(1.dp, LocalJourneyPalette.current.border),
        shape = RoundedCornerShape(20.dp),
    ) {
        Column(
            Modifier.padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
            content = content,
        )
    }
}

@Composable
fun Heading(title: String, sub: String = "") {
    Text(title, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Medium)
    if (sub.isNotEmpty()) Text(sub, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

@Composable
fun Sheet(title: String, onClose: () -> Unit,
    onDone: (() -> Unit)? = null, doneEnabled: Boolean = true,
    content: @Composable ColumnScope.() -> Unit) {
    androidx.compose.ui.window.Dialog(
        onDismissRequest = onClose,
        properties = androidx.compose.ui.window.DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Surface(
            shape = RoundedCornerShape(24.dp),
            modifier = Modifier.fillMaxWidth().padding(12.dp).heightIn(max = 760.dp),
        ) {
            Column(
                Modifier.padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(title, style = MaterialTheme.typography.titleLarge)
                    Row {
                        TextButton(onClose) { Text(if (onDone != null) "收起" else "关闭") }
                        if (onDone != null) TextButton(onDone, enabled = doneEnabled) { Text("完成", maxLines = 1) }
                    }
                }
                Column(Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(12.dp)) { content() }
            }
        }
    }
}

val LocalUndoHost = staticCompositionLocalOf { SnackbarHostState() }
val LocalUndoScope = staticCompositionLocalOf<CoroutineScope> { error("JourneyApp scope required") }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun JourneyApp(s: JourneyStore, initialInvite: String?) {
    val keyboard = LocalSoftwareKeyboardController.current
    val focus = LocalFocusManager.current
    LaunchedEffect(s.user?.s("id")) {
        if (s.user != null) {
            focus.clearFocus()
            keyboard?.hide()
        }
    }
    var modal by remember { mutableStateOf("") }
    var editing by remember { mutableStateOf<JSONObject?>(null) }
    var initialPlace by remember { mutableStateOf<JSONObject?>(null) }
    var invite by remember { mutableStateOf(initialInvite.orEmpty()) }
    var routeFrom by remember { mutableStateOf<JSONObject?>(null) }
    var routeTo by remember { mutableStateOf<JSONObject?>(null) }
    var routeObject by remember { mutableStateOf<JSONObject?>(null) }
    LaunchedEffect(s.user?.s("id"), initialInvite) {
        if (s.user != null && !initialInvite.isNullOrBlank()) modal = "join"
    }
    val trip = s.snapshot?.o("trip")
    val undoHost = remember { SnackbarHostState() }
    val undoScope = rememberCoroutineScope()
    CompositionLocalProvider(LocalUndoHost provides undoHost, LocalUndoScope provides undoScope) {
    JourneyBackdrop {
        Scaffold(
            snackbarHost = { SnackbarHost(undoHost) },
            containerColor = Color.Transparent,
            topBar = {
                TopAppBar(
                    colors = TopAppBarDefaults.topAppBarColors(containerColor = Color.Transparent),
                    title = {
                        Text(
                            if (s.tripId == null) "同行  JOURNEY" else trip?.s("name") ?: "旅程",
                            maxLines = 1,
                        )
                    },
                    navigationIcon = {
                        if (s.tripId != null)
                            IconButton({ s.home() }) { Icon(Icons.Outlined.ArrowBack, "返回旅程列表") }
                    },
                    actions = {
                        if (s.user != null) {
                            IconButton({ s.action { s.retry() } }) {
                                Icon(if (s.status == "已同步") Icons.Outlined.CloudDone else Icons.Outlined.CloudOff,
                                    s.status + "，点按同步")
                            }
                            if (s.status != "已同步") Text(s.status, style = MaterialTheme.typography.labelSmall)
                        }
                        if (s.user != null)
                            IconButton({ modal = "profile" }) {
                                Icon(Icons.Outlined.AccountCircle, "个人设置")
                            }
                    },
                )
            },
            bottomBar = {
                if (s.tripId != null) {
                    Surface(
                        modifier = Modifier.navigationBarsPadding().padding(horizontal = 20.dp, vertical = 12.dp),
                        shape = RoundedCornerShape(32.dp),
                        color = LocalJourneyPalette.current.elevated,
                        border = BorderStroke(1.dp, LocalJourneyPalette.current.border),
                        shadowElevation = 3.dp,
                    ) {
                        NavigationBar(
                            containerColor = Color.Transparent,
                            tonalElevation = 0.dp,
                            windowInsets = WindowInsets(0, 0, 0, 0),
                        ) {
                            listOf(
                                "行程" to Icons.Outlined.EventNote,
                                "地图" to Icons.Outlined.Map,
                                "费用" to Icons.Outlined.Payments,
                                "管理" to Icons.Outlined.Settings,
                            ).forEach { (name, icon) ->
                                NavigationBarItem(
                                    selected = s.page == name,
                                    onClick = { s.page = name },
                                    icon = { Icon(icon, name) },
                                    label = { Text(name) },
                                    colors = NavigationBarItemDefaults.colors(
                                        selectedIconColor = MaterialTheme.colorScheme.primary,
                                        selectedTextColor = MaterialTheme.colorScheme.primary,
                                        indicatorColor = LocalJourneyPalette.current.selected,
                                        unselectedIconColor = LocalJourneyPalette.current.muted,
                                        unselectedTextColor = LocalJourneyPalette.current.muted,
                                    ),
                                )
                            }
                        }
                    }
                }
            },
        ) { padding ->
            PullToRefreshBox(isRefreshing = s.user != null && s.busy,
                onRefresh = { if (s.user != null) s.action { s.retry() } },
                modifier = Modifier.fillMaxSize().padding(padding)) {
            Column(Modifier.fillMaxSize()) {
                when {
                    !s.ready ->
                        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                            CircularProgressIndicator()
                        }
                    s.user == null || s.sessionExpired -> LoginScreen(s)
                    s.tripId == null ->
                        Column(
                            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),
                            verticalArrangement = Arrangement.spacedBy(16.dp),
                        ) {
                            Heading("我的旅程")
                            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                SecondaryButton({ modal = "create" }) { Text("创建旅程") }
                                SecondaryButton({ modal = "join" }) { Text("加入旅程") }
                            }
                            if (s.trips.isEmpty())
                                Panel {
                                    Text(if (s.status == "离线") "本机暂时没有旅程，连接后刷新" else "还没有旅程，从创建或加入开始")
                                }
                            s.trips.forEach { t ->
                                Card(
                                    onClick = { s.action { s.openTrip(t.s("id")) } },
                                    modifier = Modifier.fillMaxWidth(),
                                    shape = RoundedCornerShape(24.dp),
                                    colors = CardDefaults.cardColors(containerColor = LocalJourneyPalette.current.card),
                                    border = BorderStroke(1.dp, LocalJourneyPalette.current.border),
                                ) {
                                    Column(
                                        Modifier.padding(22.dp),
                                        verticalArrangement = Arrangement.spacedBy(8.dp),
                                    ) {
                                        Icon(
                                            Icons.Outlined.Explore,
                                            null,
                                            modifier = Modifier.background(LocalJourneyPalette.current.icon, RoundedCornerShape(14.dp)).padding(12.dp),
                                            tint = MaterialTheme.colorScheme.primary,
                                        )
                                        Text(t.s("name"), style = MaterialTheme.typography.titleLarge)
                                        Text(
                                            listOf(
                                                    t.s("destination"),
                                                    t.s("startDate"),
                                                    if (t.optBoolean("archived")) "已归档" else "",
                                                )
                                                .filter { it.isNotEmpty() }
                                                .joinToString(" · "),
                                            style = MaterialTheme.typography.bodyMedium,
                                        )
                                    }
                                }
                            }
                        }
                    s.page == "地图" ->
                        NativeMapScreen(
                            s,
                            onActivity = { p ->
                                editing = null
                                initialPlace = p
                                modal = "activity"
                            },
                        )
                    else ->
                        Column(
                            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),
                            verticalArrangement = Arrangement.spacedBy(16.dp),
                        ) {
                            if (
                                s.pending.any {
                                    it.s("blocked").isNotEmpty() || it.optBoolean("unknown")
                                }
                            )
                                RecoveryPanel(s)
                            when (s.page) {
                                "行程" ->
                                    ItineraryScreen(
                                        s,
                                        onEdit = { o ->
                                            editing = o
                                            initialPlace = null
                                            modal = "activity"
                                        },
                                        onSchedule = { modal = "schedule" },
                                        onRoute = { from, to, route ->
                                            routeFrom = from
                                            routeTo = to
                                            routeObject = route
                                            modal = "route"
                                        },
                                    )
                                "费用" ->
                                    LedgerScreen(s) { o ->
                                        editing = o
                                        modal = "expense"
                                    }
                                "管理" ->
                                    ManagementScreen(
                                        s,
                                        onInvite = { modal = "invites" },
                                        onRename = { modal = "rename" },
                                    )
                            }
                        }
                }
            }
        }
    }
    }
    if (s.error != null)
        AlertDialog(
            onDismissRequest = { s.error = null },
            title = { Text("操作未完成") },
            text = { Text(s.error!!) },
            confirmButton = { TextButton({ s.error = null }) { Text("知道了") } },
        )
    when (modal) {
        "profile" -> ProfileSheet(s) { modal = "" }
        "create" -> CreateSheet(s) { modal = "" }
        "join" -> JoinSheet(s, invite, { invite = it }) { modal = "" }
        "activity" -> ActivitySheet(s, editing, initialPlace) { modal = "" }
        "expense" -> ExpenseSheet(s, editing) { modal = "" }
        "schedule" -> ScheduleSheet(s) { modal = "" }
        "invites" -> InvitesSheet(s) { modal = "" }
        "rename" -> RenameSheet(s) { modal = "" }
        "route" -> routeTo?.let { RouteSheet(s, routeFrom, it, routeObject) { modal = "" } }
    }
    }
}

@Composable
fun LoginScreen(s: JourneyStore) {
    var register by remember { mutableStateOf(false) }
    var identifier by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var name by remember { mutableStateOf("") }
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(28.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Spacer(Modifier.height(36.dp))
        Icon(
            Icons.Outlined.Explore,
            null,
            Modifier.background(LocalJourneyPalette.current.icon, RoundedCornerShape(22.dp)).padding(16.dp).size(40.dp),
            tint = MaterialTheme.colorScheme.primary,
        )
        Heading("好旅程，从同行开始", "把想去的地方，变成共同的回忆。")
        Row {
            FilterChip(!register, { register = false }, label = { Text("登录") })
            Spacer(Modifier.width(12.dp))
            FilterChip(register, { register = true }, label = { Text("注册") })
        }
        Field("邮箱或手机号", identifier, { identifier = it })
        if (register) Field("你的名字", name, { name = it })
        OutlinedTextField(
            password,
            { password = it },
            label = { Text("密码") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            shape = RoundedCornerShape(14.dp),
        )
        Button(
            onClick = { s.action { s.login(identifier, password, name, register) } },
            enabled = !s.busy && identifier.isNotBlank() && password.isNotBlank(),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(if (s.busy) "正在连接…" else if (register) "创建账号" else "登录")
        }
    }
}

@Composable
fun CreateSheet(s: JourneyStore, close: () -> Unit) {
    var name by remember { mutableStateOf("") }
    var destination by remember { mutableStateOf("") }
    var start by remember { mutableStateOf(LocalDate.now().toString()) }
    var end by remember { mutableStateOf(LocalDate.now().plusDays(2).toString()) }
    var zone by remember { mutableStateOf("") }
    var currency by remember { mutableStateOf("CNY") }
    var mode by remember { mutableStateOf("") }
    Sheet("创建旅程", close) {
        Field("旅程名称", name, { name = it })
        Field(
            "目的地",
            destination,
            {
                destination = it
                zone = ""
            },
        )
        SecondaryButton({
            s.action {
                val r =
                    s.api.request(
                        "/_AMapService/v3/geocode/geo?address=${JourneyApi.encode(destination)}"
                    )
                zone =
                    timezoneForAdcode(r.a("geocodes").rows().firstOrNull()?.s("adcode").orEmpty())
                        ?: ""
                if (zone.isEmpty()) throw IllegalStateException("请手动填写目的地时区")
            }
        }) {
            Text("查询目的地时区")
        }
        Field("开始日期 YYYY-MM-DD", start, { start = it })
        Field("结束日期 YYYY-MM-DD", end, { end = it })
        Field("当地时区，如 Asia/Shanghai", zone, { zone = it })
        Field("默认币种", currency, { currency = it.uppercase() })
        Choice("团队模式", mode, listOf("管理员管理", "平等协作")) { mode = it }
        Text(
            if (mode == "平等协作") "成员共同决定内容的删除与恢复。" else "管理员可以管理成员与删除内容。",
            style = MaterialTheme.typography.bodySmall,
        )
        Button(
            {
                s.action {
                    val a = LocalDate.parse(start)
                    val b = LocalDate.parse(end)
                    val count = ChronoUnit.DAYS.between(a, b) + 1
                    require(count in 1..365) { "日期范围需为 1–365 天" }
                    ZoneId.of(zone)
                    s.createTrip(
                        obj(
                            "name" to name.trim(),
                            "destination" to destination.trim(),
                            "startDate" to a.toString(),
                            "dayCount" to count,
                            "timezone" to zone,
                            "currency" to currency,
                            "teamMode" to if (mode == "平等协作") "equal" else "admin",
                        )
                    )
                    close()
                }
            },
            enabled =
                !s.busy &&
                    name.isNotBlank() &&
                    destination.isNotBlank() &&
                    zone.isNotBlank() &&
                    mode.isNotBlank(),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text("创建旅程")
        }
    }
}

@Composable
fun JoinSheet(s: JourneyStore, code: String, setCode: (String) -> Unit, close: () -> Unit) {
    var preview by remember { mutableStateOf<JSONObject?>(null) }
    val normalized = normalizeInvite(code)
    Sheet("加入旅程", close) {
        Field(
            "邀请码或邀请链接",
            code,
            {
                setCode(it)
                preview = null
            },
        )
        SecondaryButton(
            {
                s.action {
                    preview = s.api.request("/api/invites/${JourneyApi.encode(normalized)}")
                }
            },
            enabled = normalized.isNotBlank(),
        ) {
            Text("查看邀请")
        }
        preview?.let {
            Panel {
                Text(it.s("name"), style = MaterialTheme.typography.titleLarge)
                Text(if (it.s("teamMode") == "equal") "平等协作" else "管理员管理")
            }
            Button({
                s.action {
                    s.join(normalized)
                    close()
                }
            }) {
                Text("加入旅程")
            }
        }
    }
}

@Composable
fun ItineraryScreen(
    s: JourneyStore,
    onEdit: (JSONObject?) -> Unit,
    onSchedule: () -> Unit,
    onRoute: (JSONObject?, JSONObject, JSONObject?) -> Unit,
) {
    val days =
        s.objects("day")
            .filter { it.s("state") == "active" }
            .sortedWith(
                compareBy<JSONObject> { it.o("payload").s("date", "9999") }
                    .thenBy { it.o("payload").optInt("ordinal") }
            )
    val day = days.find { it.s("id") == s.selectedDay } ?: days.firstOrNull()
    val id = day?.s("id")
    LaunchedEffect(id) { s.selectedDay = id }
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Heading("行程")
        IconButton(onSchedule) { Icon(Icons.Outlined.DateRange, "调整日期") }
    }
    Row(
        Modifier.horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        days.forEach { d ->
            FilterChip(
                d.s("id") == id,
                { s.selectedDay = d.s("id") },
                label = {
                    Column {
                        Text("第 ${d.o("payload").optInt("ordinal")} 天")
                        Text(
                            d.o("payload").s("date", "日期待定"),
                            style = MaterialTheme.typography.labelSmall,
                        )
                    }
                },
            )
        }
    }
    Button({ onEdit(null) }, enabled = id != null) {
        Icon(Icons.Outlined.Add, null)
        Text("添加活动")
    }
    var sorting by remember(id) { mutableStateOf(false) }
    val positions = remember(id) { mutableMapOf<String, Float>() }
    var dragging by remember(id) { mutableStateOf<String?>(null) }
    Row {
        TextButton({ sorting = !sorting }) { Text(if (sorting) "完成排序" else "排序") }
        if (sorting) Text("长按拖动", style = MaterialTheme.typography.bodySmall)
    }
    val rows = orderedActivities(s.objects(), id.orEmpty())
    val currentRows by rememberUpdatedState(rows)
    if (rows.isEmpty()) Panel { Text("这一天还没有安排，添上第一站吧。") }
    rows.forEachIndexed { i, o ->
        val p = o.o("payload")
        RouteLink(s, rows.getOrNull(i - 1), o, onRoute, showEmpty = sorting)
        key(o.s("id")) {
        var distance by remember { mutableFloatStateOf(0f) }
        var startY by remember { mutableFloatStateOf(0f) }
        Panel(Modifier.onGloballyPositioned { positions[o.s("id")] = it.positionInRoot().y }
            .zIndex(if (dragging == o.s("id")) 1f else 0f)
            .graphicsLayer { translationY = if (dragging == o.s("id")) distance else 0f }
            .pointerInput(sorting, o.s("id"), p.o("time").s("mode")) {
                if (sorting && o.o("payload").o("time").s("mode") != "precise") detectDragGesturesAfterLongPress(
                    onDragStart = { distance = 0f; startY = positions[o.s("id")] ?: 0f; dragging = o.s("id") },
                    onDrag = { change, delta -> change.consume(); distance += delta.y },
                    onDragCancel = { dragging = null },
                    onDragEnd = {
                        val from = currentRows.indexOfFirst { it.s("id") == o.s("id") }
                        val target = currentRows.indices.minByOrNull { index ->
                            abs((positions[currentRows[index].s("id")] ?: startY) - (startY + distance))
                        } ?: from
                        if (from >= 0 && target != from) s.action { s.moveActivity(o.s("id"), target - from) }
                        dragging = null
                    },
                )
            }) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                if (sorting) {
                    if (p.o("time").s("mode") == "precise") Text("按时间排序", style = MaterialTheme.typography.labelSmall)
                    else Icon(Icons.Outlined.DragHandle, "长按拖动排序")
                }
                Text(
                    "${i+1}  ${p.s("title")}",
                    style = MaterialTheme.typography.titleMedium,
                    modifier = Modifier.weight(1f),
                )

            }
            val t = p.o("time")
            Text(
                if (t.s("mode") == "precise")
                    listOf(t.s("start"), t.s("end"))
                        .filter { it.isNotEmpty() }
                        .joinToString(" – ") +
                        if (t.optInt("endDayOffset") > 0) "（+${t.optInt("endDayOffset")}天）" else ""
                else t.s("period", "时间灵活"),
                color = MaterialTheme.colorScheme.primary,
            )
            if (p.o("place").s("name").isNotEmpty()) Text("⌖ " + p.o("place").s("name"))
            if (p.s("notes").isNotEmpty()) Text(p.s("notes"), maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
            if (p.s("url").isNotEmpty()) {
                val ctx = LocalContext.current
                TextButton({
                    ctx.startActivity(Intent(Intent.ACTION_VIEW, android.net.Uri.parse(p.s("url"))))
                }) {
                    Text("打开相关链接")
                }
            }
            if (dragging == o.s("id")) Text("拖动到新的位置", color = MaterialTheme.colorScheme.primary)
            ObjectActions(s, o, onEdit = { onEdit(o) }, onMap = if (p.o("place").s("name").isNotBlank()) ({ s.page = "地图" }) else null)
        }
        }
    }
    val deleted =
        s.objects().filter {
            it.s("state") == "deleted" && it.s("kind") in setOf("activity", "day")
        }
    if (deleted.isNotEmpty()) {
        Text("已删除的安排", style = MaterialTheme.typography.titleMedium)
        deleted.forEach {
            Panel {
                Text(it.o("payload").s("title", "第 ${it.o("payload").optInt("ordinal")} 天"))
                ObjectActions(s, it)
            }
        }
    }
}

@Composable
fun ObjectActions(s: JourneyStore, o: JSONObject, onEdit: (() -> Unit)? = null, onMap: (() -> Unit)? = null) {
    val expressions = o.a("expressions").rows()
    val own = expressions.find { it.s("userId") == s.user?.s("id") }
    val deleted = o.s("state") == "deleted"
    val trip = s.snapshot?.o("trip") ?: return
    val me = s.snapshot?.a("members")?.rows()?.find { it.s("userId") == s.user?.s("id") }
    val canDelete = trip.s("ownerId") == s.user?.s("id") ||
        (trip.s("teamMode") == "admin" && me?.optBoolean("isAdmin") == true)
    val canRestore = trip.s("ownerId") == s.user?.s("id") || me?.optBoolean("isAdmin") == true
    var expanded by remember { mutableStateOf(false) }
    val scope = LocalUndoScope.current
    val host = LocalUndoHost.current
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            val absent = expressions.count { it.optBoolean("notParticipating") }
            val wishes = expressions.count { it.optBoolean(if (deleted) "wishRestore" else "wishDelete") }
            if (absent > 0) Text("$absent 人不参加", style = MaterialTheme.typography.labelSmall)
            if (wishes > 0) Text("$wishes 人" + if (deleted) "支持恢复" else "希望删除", style = MaterialTheme.typography.labelSmall)
        }
        Box {
            IconButton({ expanded = true }) { Icon(Icons.Outlined.MoreVert, "更多操作") }
            DropdownMenu(expanded, { expanded = false }) {
                if (!deleted && onEdit != null) DropdownMenuItem(text = { Text("编辑") },
                    leadingIcon = { Icon(Icons.Outlined.Edit, null) }, onClick = { expanded = false; onEdit() })
                if (!deleted && onMap != null) DropdownMenuItem(text = { Text("在地图查看") },
                    leadingIcon = { Icon(Icons.Outlined.Map, null) }, onClick = { expanded = false; onMap() })
                if (!deleted && o.s("kind") == "activity") DropdownMenuItem(
                    text = { Text(if (own?.optBoolean("notParticipating") == true) "重新参加" else "不参加") },
                    onClick = {
                        expanded = false
                        s.action { s.mutate("express", o.s("id"), generation = o.optInt("generation"),
                            expression = obj("notParticipating" to !(own?.optBoolean("notParticipating") ?: false))) }
                    })
                val field = if (deleted) "wishRestore" else "wishDelete"
                DropdownMenuItem(text = { Text((if (own?.optBoolean(field) == true) "取消" else "") +
                    if (deleted) "支持恢复" else "希望删除") }, onClick = {
                    expanded = false
                    s.action { s.mutate("express", o.s("id"), generation = o.optInt("generation"),
                        expression = obj(field to !(own?.optBoolean(field) ?: false))) }
                })
                if (if (deleted) canRestore else canDelete) {
                    HorizontalDivider()
                    DropdownMenuItem(text = { Text(if (deleted) "恢复" else "删除",
                        color = if (deleted) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error) },
                        leadingIcon = { Icon(if (deleted) Icons.Outlined.Restore else Icons.Outlined.Delete, null) },
                        onClick = {
                            expanded = false
                            s.action {
                                s.mutate(if (deleted) "restore" else "delete", o.s("id"), generation = o.optInt("generation"))
                                if (!deleted) {
                                    val undoGeneration = s.objects().find { it.s("id") == o.s("id") }?.optInt("generation")
                                        ?: s.snapshot?.o("trip")?.optInt("generation") ?: o.optInt("generation") + 1
                                    scope.launch {
                                        if (host.showSnackbar("已删除", "撤销", duration = SnackbarDuration.Long) == SnackbarResult.ActionPerformed)
                                            s.action { s.mutate("restore", o.s("id"), generation = undoGeneration) }
                                    }
                                }
                            }
                        })
                }
            }
        }
    }
}
