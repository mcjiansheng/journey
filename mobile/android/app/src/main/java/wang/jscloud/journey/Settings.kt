package wang.jscloud.journey

import android.content.Intent
import android.provider.Settings
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProfileSheet(s: JourneyStore, initialCategory: String = "", close: () -> Unit) {
    var category by remember { mutableStateOf(initialCategory) }
    var name by remember { mutableStateOf(s.user?.s("displayName").orEmpty()) }
    val preferences = s.user?.o("preferences") ?: org.json.JSONObject()
    val paletteName = preferences.s("palette", "forest")
    val theme = preferences.s("theme", "system")
    val p = LocalJourneyPalette.current
    val context = LocalContext.current
    fun setPreference(key: String, value: Any) {
        s.action { s.profile(s.user?.s("displayName").orEmpty(), obj(key to value)) }
    }
    Dialog(onDismissRequest = close, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        BackHandler { if (category.isNotEmpty()) category = "" else close() }
        Surface(Modifier.fillMaxSize(), color = p.page) {
            Column {
                TopAppBar(
                    title = { Text(category.ifEmpty { "我的设置" }) },
                    // 首页只放一个“关闭”；进入分类后左上角返回上一级，右上角“完成”直接关掉设置
                    navigationIcon = {
                        if (category.isEmpty()) IconButton(close) { Icon(Icons.Outlined.Close, "关闭") }
                        else IconButton({ category = "" }) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "返回") }
                    },
                    actions = { if (category.isNotEmpty()) TextButton(close) { Text("完成") } },
                    colors = TopAppBarDefaults.topAppBarColors(containerColor = p.page),
                )
                Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    when (category) {
                        "" -> {
                            Panel {
                                Icon(Icons.Outlined.AccountCircle, null, Modifier.size(40.dp))
                                Text(s.user?.s("displayName").orEmpty(), style = MaterialTheme.typography.titleLarge)
                                Text("只对你自己生效，在所有旅程中通用", color = p.muted)
                            }
                            listOf(
                                Triple("外观", (if (paletteName == "atlas") "海图蓝" else "森林绿") + " · " + themeLabel(theme), Icons.Outlined.Palette),
                                Triple("辅助功能", "减少动态效果", Icons.Outlined.AccessibilityNew),
                                Triple("通知与提示", "系统通知设置", Icons.Outlined.Notifications),
                                Triple("保存与同步", s.status, Icons.Outlined.CloudDone),
                                Triple("账号", s.user?.s("identifier").orEmpty(), Icons.Outlined.AccountCircle),
                            ).forEach { (title, value, icon) ->
                                ListItem(
                                    headlineContent = { Text(title) }, supportingContent = { Text(value) },
                                    leadingContent = { Icon(icon, null) },
                                    trailingContent = { Icon(Icons.Outlined.ChevronRight, null) },
                                    colors = ListItemDefaults.colors(containerColor = p.card),
                                    modifier = Modifier.clickable { category = title },
                                )
                            }
                            TextButton({ s.action { s.logout(); close() } }, enabled = !s.busy) {
                                Text("退出登录", color = p.danger)
                            }
                        }
                        "外观" -> {
                            Text("主题色", style = MaterialTheme.typography.titleMedium)
                            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                listOf("forest" to "森林绿", "atlas" to "海图蓝").forEach { (value, label) ->
                                    AppearancePreview(label, DesignTokens.palette(value, p.dark), paletteName == value,
                                        Modifier.weight(1f), enabled = !s.busy) { setPreference("palette", value) }
                                }
                            }
                            Text("明暗", style = MaterialTheme.typography.titleMedium)
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                listOf("system", "light", "dark").forEach { value ->
                                    // “跟随系统”左半浅色、右半深色，与网页、iOS 一致
                                    AppearancePreview(themeLabel(value), DesignTokens.palette(paletteName, value == "dark"),
                                        theme == value, Modifier.weight(1f), enabled = !s.busy,
                                        splitDark = if (value == "system") DesignTokens.palette(paletteName, true) else null,
                                    ) { setPreference("theme", value) }
                                }
                            }
                            // Android 没有系统级“减少透明度”设置，“跟随系统”无从跟随，所以用开关（与“只有开/关→开关”的规则一致）
                            Panel {
                                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                        Text("减少透明效果", style = MaterialTheme.typography.titleMedium)
                                        Text("使用不透明的实底卡片和面板，不显示毛玻璃和高光。", color = p.muted,
                                            style = MaterialTheme.typography.bodyMedium)
                                    }
                                    Switch(preferences.opt("reducedTransparency") == true,
                                        { setPreference("reducedTransparency", it) }, enabled = !s.busy,
                                        colors = SwitchDefaults.colors(
                                            checkedTrackColor = p.primary, checkedThumbColor = p.onPrimary,
                                            uncheckedTrackColor = p.page, uncheckedThumbColor = p.muted,
                                            uncheckedBorderColor = p.muted,
                                        ))
                                }
                            }
                        }
                        "辅助功能" -> Panel {
                            Text("减少动态效果", style = MaterialTheme.typography.titleMedium)
                            Text("减少地图移动动画。", color = p.muted)
                            SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                                listOf("system" to "跟随系统", "false" to "关", "true" to "开").forEachIndexed { index, (value, label) ->
                                    SegmentedButton(selected = preferences.opt("reducedMotion")?.toString().let { (it ?: "system") == value },
                                        onClick = { setPreference("reducedMotion", when(value) { "true" -> true; "false" -> false; else -> "system" }) },
                                        shape = SegmentedButtonDefaults.itemShape(index, 3), enabled = !s.busy) { Text(label) }
                                }
                            }
                        }
                        "通知与提示" -> Panel {
                            Text("通知", style = MaterialTheme.typography.titleMedium)
                            Text("在系统设置中管理同行的通知、提示音和振动。", color = p.muted)
                            SecondaryButton({ context.startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                                .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)) }) { Text("打开系统设置") }
                        }
                        "保存与同步" -> {
                            Panel {
                                Text(s.status, style = MaterialTheme.typography.titleMedium)
                                Text(if (s.pending.isEmpty()) "所有修改已保存" else "${s.pending.size} 项修改等待同步")
                                Button({ s.action { s.retry() } }, enabled = !s.busy) { Text("立即同步") }
                            }
                            Panel {
                                Text("本机存储", style = MaterialTheme.typography.titleMedium)
                                Text("旅程、草稿和未上传的修改会保存在这台设备。", color = p.muted)
                            }
                            RecoveryPanel(s)
                        }
                        "账号" -> {
                            Text(s.user?.s("identifier").orEmpty(), color = p.muted)
                            Field("你的名字", name, { name = it })
                            Button({ s.action { s.profile(name, obj()); category = "" } }, enabled = name.isNotBlank() && !s.busy) { Text("保存称呼") }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun PreviewMock(colors: DesignTokens.Colors, modifier: Modifier = Modifier) {
    Row(modifier.fillMaxWidth().height(68.dp).background(colors.page, RoundedCornerShape(8.dp)),
        horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Column(Modifier.width(16.dp).fillMaxHeight().background(colors.surface, RoundedCornerShape(4.dp)).padding(3.dp)) {
            Box(Modifier.fillMaxWidth().height(7.dp).background(colors.primary, RoundedCornerShape(2.dp)))
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Box(Modifier.fillMaxWidth(.7f).height(6.dp).background(colors.primary, RoundedCornerShape(3.dp)))
            repeat(2) {
                Box(Modifier.fillMaxWidth().weight(1f).background(colors.surface, RoundedCornerShape(4.dp)).padding(5.dp)) {
                    Box(Modifier.fillMaxWidth(.6f).height(4.dp).background(colors.muted, RoundedCornerShape(2.dp)))
                }
            }
        }
    }
}

private fun themeLabel(value: String) = when (value) { "dark" -> "深色"; "light" -> "浅色"; else -> "跟随系统" }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AppearancePreview(label: String, colors: DesignTokens.Colors, selected: Boolean,
    modifier: Modifier, enabled: Boolean, splitDark: DesignTokens.Colors? = null, onClick: () -> Unit) {
    Surface(selected = selected, onClick = onClick, enabled = enabled, modifier = modifier,
        color = colors.page, contentColor = colors.text, shape = RoundedCornerShape(16.dp),
        border = BorderStroke(if (selected) 2.dp else 1.dp, if (selected) colors.primary else colors.border)) {
        Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Box {
                PreviewMock(colors)
                if (splitDark != null) PreviewMock(splitDark, Modifier.drawWithContent {
                    clipRect(left = size.width / 2f) { this@drawWithContent.drawContent() }
                })
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(label, style = MaterialTheme.typography.labelMedium, modifier = Modifier.weight(1f))
                if (selected) Icon(Icons.Outlined.CheckCircle, "已选中", Modifier.size(16.dp), tint = colors.primary)
            }
        }
    }
}
