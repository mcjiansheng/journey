package wang.jscloud.journey

import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test

class NativeFlowTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()

    private fun waitText(text: String, substring: Boolean = false) {
        compose.waitUntil(30000) {
            compose
                .onAllNodesWithText(text, substring = substring, useUnmergedTree = true)
                .fetchSemanticsNodes()
                .isNotEmpty()
        }
    }

    private fun capture(name: String) {
        compose.waitForIdle()
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        // Compose can be idle before a closing Android dialog reaches the display buffer.
        instrumentation.waitForIdleSync()
        android.os.SystemClock.sleep(500)
        compose.waitForIdle()
        instrumentation.waitForIdleSync()
        val directory =
            java.io
                .File(instrumentation.targetContext.getExternalFilesDir(null), "acceptance")
                .apply { mkdirs() }
        val screenshot = instrumentation.uiAutomation.takeScreenshot()
        java.io.FileOutputStream(java.io.File(directory, "$name.png")).use {
            screenshot.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it)
        }
        screenshot.recycle()
    }

    @Test
    fun palettesAndFlatSettingsScreenshots() {
        val args = InstrumentationRegistry.getArguments()
        val identifier = args.getString("identifier")
        val password = args.getString("password")
        val trip = args.getString("tripName")
        assumeTrue("Pass fixture account and tripName", identifier != null && password != null && trip != null)
        compose.waitUntil(30000) {
            compose.onAllNodesWithText("邮箱或手机号").fetchSemanticsNodes().isNotEmpty() ||
                compose.onAllNodesWithContentDescription("我的设置").fetchSemanticsNodes().isNotEmpty()
        }
        if (compose.onAllNodesWithText("邮箱或手机号").fetchSemanticsNodes().isNotEmpty()) {
            compose.onNodeWithText("邮箱或手机号").performTextInput(identifier!!)
            compose.onNodeWithText("密码").performTextInput(password!!)
            compose.onAllNodesWithText("登录").onLast().performClick()
        }
        waitText(trip!!)
        for ((palette, label) in listOf("forest" to "森林绿", "atlas" to "海图蓝")) {
            for ((theme, choice) in listOf("light" to "浅色", "dark" to "深色")) {
                compose.onNodeWithContentDescription("我的设置").performClick()
                compose.onNodeWithText("外观").performClick()
                compose.onNodeWithText(label).performClick()
                compose.waitUntil(15000) { compose.onAllNodes(hasText(label) and isSelected()).fetchSemanticsNodes().isNotEmpty() }
                compose.onNodeWithText(choice).performClick()
                compose.waitUntil(15000) { compose.onAllNodes(hasText(choice) and isSelected()).fetchSemanticsNodes().isNotEmpty() }
                if (compose.onAllNodes(isToggleable() and isOn()).fetchSemanticsNodes().isNotEmpty()) {
                    compose.onNode(isToggleable()).performScrollTo().performClick()
                    compose.waitUntil(15000) { compose.onAllNodes(isToggleable() and isOff()).fetchSemanticsNodes().isNotEmpty() }
                }
                capture("android-$palette-$theme-appearance")
                compose.onNodeWithContentDescription("返回").performClick()
                capture("android-$palette-$theme-settings-home")
                compose.onNodeWithContentDescription("关闭").performClick()
                capture("android-$palette-$theme-home")
                compose.onNodeWithText(trip).performClick()
                waitText("行程")
                compose.onNode(hasText("行程", substring = false) and hasClickAction()).performClick()
                waitText("添加活动")
                capture("android-$palette-$theme-itinerary")
                compose.onNodeWithContentDescription("我的设置").performClick()
                compose.onNodeWithText("外观").performClick()
                compose.onNode(isToggleable()).performScrollTo().performClick()
                compose.waitUntil(15000) { compose.onAllNodes(isToggleable() and isOn()).fetchSemanticsNodes().isNotEmpty() }
                capture("android-$palette-$theme-flat-appearance")
                compose.onNodeWithText("完成").performClick()
                capture("android-$palette-$theme-flat-itinerary")
                compose.onNode(hasText("旅程设置", substring = false) and hasClickAction()).performClick()
                waitText("同步给", substring = true)
                capture("android-$palette-$theme-trip-settings")
                compose.onNodeWithContentDescription("我的设置").performClick()
                compose.onNodeWithText("外观").performClick()
                compose.onNode(isToggleable()).performScrollTo().performClick()
                compose.waitUntil(15000) { compose.onAllNodes(isToggleable() and isOff()).fetchSemanticsNodes().isNotEmpty() }
                compose.onNodeWithText("完成").performClick()
                compose.onNodeWithContentDescription("返回旅程列表").performClick()
                waitText(trip)
            }
        }
    }

    @Test
    fun r3LightAndDarkScreenshots() {
        val args = InstrumentationRegistry.getArguments()
        val identifier = args.getString("identifier")
        val password = args.getString("password")
        val trip = args.getString("tripName")
        assumeTrue("Pass fixture account and tripName", identifier != null && password != null && trip != null)
        compose.waitUntil(30000) {
            compose.onAllNodesWithText("邮箱或手机号").fetchSemanticsNodes().isNotEmpty() ||
                compose.onAllNodesWithContentDescription("我的设置").fetchSemanticsNodes().isNotEmpty()
        }
        if (compose.onAllNodesWithContentDescription("我的设置").fetchSemanticsNodes().isNotEmpty()) {
            compose.onNodeWithContentDescription("我的设置").performClick()
            compose.onNodeWithText("退出登录").performScrollTo().performClick()
            waitText("邮箱或手机号")
        }
        compose.onNodeWithText("邮箱或手机号").performTextInput(identifier!!)
        compose.onNodeWithText("密码").performTextInput(password!!)
        compose.onAllNodesWithText("登录").onLast().performClick()
        waitText(trip!!)
        for ((theme, choice) in listOf("light" to "浅色", "dark" to "深色")) {
            compose.onNodeWithContentDescription("我的设置").performClick()
            compose.onNodeWithText("外观").performClick()
            compose.onAllNodesWithText(choice).onLast().performClick()
            compose.waitUntil(10000) { compose.onAllNodesWithText("完成").fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithText("完成").performClick()
            compose.waitUntil(10000) { compose.onAllNodes(isDialog()).fetchSemanticsNodes().isEmpty() }
            compose.onNodeWithText("我的旅程").assertExists()
            capture("android-$theme-home")
            if (args.getString("homeOnly") == "true") continue
            compose.onNodeWithText(trip).performClick()
            waitText("行程")
            compose.onNode(hasText("行程", substring = false) and hasClickAction()).performClick()
            waitText("添加活动")
            capture("android-$theme-itinerary")
            compose.onNodeWithText("添加活动").performScrollTo().performClick()
            waitText("活动名称")
            compose.onNodeWithText("完成", substring = false).assertExists()
            capture("android-$theme-activity-editor")
            compose.onNodeWithText("收起", substring = false).performClick()
            compose.onNodeWithText("地图", substring = false).performClick()
            waitText("我的收藏")
            compose.waitUntil(45000) {
                compose.onAllNodesWithTag("journey-map-ready").fetchSemanticsNodes().isNotEmpty() ||
                    compose.onAllNodesWithText("地图加载失败：", substring = true).fetchSemanticsNodes().isNotEmpty()
            }
            capture("android-$theme-map")
            compose.onNodeWithText("费用", substring = false).performClick()
            waitText("添加费用")
            capture("android-$theme-ledger")
            compose.onNodeWithText("旅程设置", substring = false).performClick()
            waitText("旅程设置")
            capture("android-$theme-management")
            compose.onNodeWithContentDescription("返回旅程列表").performClick()
            waitText(trip)
        }
    }

    @Test
    fun realLoginItineraryMapLedgerAndManagement() {
        val args = InstrumentationRegistry.getArguments()
        val identifier = args.getString("identifier")
        val password = args.getString("password")
        val trip = args.getString("tripName")
        assumeTrue(
            "Pass fixture identifier, password and tripName as runner arguments",
            identifier != null && password != null && trip != null,
        )
        waitText("邮箱或手机号")
        compose.onNodeWithText("邮箱或手机号").performTextInput(identifier!!)
        compose.onNodeWithText("密码").performTextInput(password!!)
        compose.onAllNodesWithText("登录").onLast().performClick()
        waitText(trip!!)
        capture("android-home")
        compose.onNodeWithText(trip).performClick()
        waitText("添加活动")
        capture("android-itinerary")
        compose.onNodeWithText("地图", substring = false).performClick()
        waitText("我的收藏")
        compose.waitUntil(45000) {
            compose.onAllNodesWithTag("journey-map-ready").fetchSemanticsNodes().isNotEmpty()
        }
        capture("android-map")
        compose.onNodeWithText("费用", substring = false).performClick()
        waitText("添加费用")
        capture("android-ledger")
        compose.onNodeWithText("添加费用").performClick()
        waitText("费用名称（可不填）")
        val title = "原生验收费用-${System.currentTimeMillis()}"
        compose.onNodeWithText("费用名称（可不填）").performTextInput(title)
        compose.onNodeWithText("金额", substring = false).performTextInput("12.50")
        compose.onNodeWithText("完成", substring = false).performClick()
        waitText(title)
        compose.onNodeWithText("旅程设置", substring = false).performClick()
        waitText("旅程设置")
        capture("android-management")
        compose.onNodeWithText("行程", substring = false).performClick()
        waitText("添加活动")
        compose.onNodeWithText("添加活动").performScrollTo().performClick()
        waitText("活动名称")
        val activity = "原生验收活动-${System.currentTimeMillis()}"
        compose.onNodeWithText("活动名称").performTextInput(activity)
        capture("android-activity-editor")
        compose.onNodeWithText("完成", substring = false).performClick()
        compose.waitUntil(30000) {
            compose
                .onAllNodesWithText(activity, substring = true)
                .fetchSemanticsNodes()
                .isNotEmpty()
        }
        // Exercise the foreground reconnection cycle, including its thread ownership.
        android.os.SystemClock.sleep(13000)
        compose.onAllNodesWithText(activity, substring = true).onFirst().assertExists()
        capture("android-itinerary-saved")
    }

    @Test
    fun n1LightAndDarkScreenshots() {
        val args = InstrumentationRegistry.getArguments()
        val identifier = args.getString("identifier")
        val password = args.getString("password")
        val trip = args.getString("tripName")
        val placeName = args.getString("placeName")
        val webInviteUrl = args.getString("webInviteUrl")
        assumeTrue(
            "Pass fixture identifier, password, tripName, placeName and webInviteUrl",
            listOf(identifier, password, trip, placeName, webInviteUrl).all { !it.isNullOrBlank() },
        )
        compose.waitUntil(30000) {
            compose.onAllNodesWithText("邮箱或手机号").fetchSemanticsNodes().isNotEmpty() ||
                compose.onAllNodesWithContentDescription("我的设置").fetchSemanticsNodes().isNotEmpty()
        }
        if (compose.onAllNodesWithText("邮箱或手机号").fetchSemanticsNodes().isNotEmpty()) {
            compose.onNodeWithText("邮箱或手机号").performTextInput(identifier!!)
            compose.onNodeWithText("密码").performTextInput(password!!)
            compose.onAllNodesWithText("登录").onLast().performClick()
        }
        waitText(trip!!)
        for ((theme, choice) in listOf("light" to "浅色", "dark" to "深色")) {
            compose.onNodeWithContentDescription("我的设置").performClick()
            compose.onNodeWithText("外观").performClick()
            compose.onAllNodesWithText(choice).onLast().performClick()
            compose.waitUntil(10000) { compose.onAllNodesWithText("完成").fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithText("完成").performClick()
            compose.waitUntil(10000) { compose.onAllNodes(isDialog()).fetchSemanticsNodes().isEmpty() }

            // 1. Join sheet + QR scan button + invite link parsing preview
            compose.onNodeWithText("加入旅程").performClick()
            waitText("扫描二维码")
            compose.onNodeWithText("邀请码或邀请链接").performTextReplacement(webInviteUrl!!)
            compose.onNodeWithText("查看邀请").performClick()
            compose.waitUntil(15000) {
                compose.onAllNodesWithText("平等协作", substring = true).fetchSemanticsNodes().isNotEmpty() ||
                    compose.onAllNodesWithText("管理员管理", substring = true).fetchSemanticsNodes().isNotEmpty()
            }
            capture("android-$theme-join-scan")
            compose.onNodeWithText("关闭").performClick()
            compose.waitUntil(10000) { compose.onAllNodes(isDialog()).fetchSemanticsNodes().isEmpty() }

            // 2. Itinerary: today, next item, back to today, delete day (in light pass)
            compose.onNodeWithText(trip).performClick()
            waitText("行程")
            compose.onNode(hasText("行程", substring = false) and hasClickAction()).performClick()
            waitText("添加活动")
            waitText("今天", substring = true)
            waitText("下一项", substring = true)
            capture("android-$theme-itinerary-today")

            compose.onNodeWithText("第 2 天", substring = true).performClick()
            waitText("回到今天")
            capture("android-$theme-itinerary-back-today")
            compose.onNodeWithText("回到今天").performClick()
            waitText("下一项", substring = true)

            if (theme == "light") {
                compose.onNodeWithText("第 3 天", substring = true).performClick()
                compose.onNodeWithContentDescription("当天菜单").performClick()
                waitText("删除这一天")
                compose.onNodeWithText("删除这一天").performClick()
                waitText("已删除", substring = true)
                compose.waitUntil(15000) {
                    compose.onAllNodesWithText("下一项", substring = true).fetchSemanticsNodes().isNotEmpty()
                }
            }

            // 3. Map: place details bottom sheet (half & full)
            compose.onNodeWithText("地图", substring = false).performClick()
            waitText("我的收藏")
            compose.waitUntil(45000) {
                compose.onAllNodesWithTag("journey-map-ready").fetchSemanticsNodes().isNotEmpty() ||
                    compose.onAllNodesWithText("地图加载失败：", substring = true).fetchSemanticsNodes().isNotEmpty()
            }
            compose.waitUntil(15000) {
                compose.onAllNodesWithText("已删除", substring = true).fetchSemanticsNodes().isEmpty()
            }
            compose.onAllNodes(hasText(placeName!!, substring = true) and hasClickAction()).onFirst()
                .performScrollTo().performClick()
            compose.waitUntil(15000) {
                compose.onAllNodesWithContentDescription("关闭地点详情").fetchSemanticsNodes().isNotEmpty()
            }
            compose.waitUntil(15000) {
                compose.onAllNodesWithText("正在载入地点…").fetchSemanticsNodes().isEmpty()
            }
            compose.onNodeWithText("加入行程").assertExists()
            compose.onNodeWithText("已收藏").assertExists()
            compose.onNodeWithText("从这里出发").assertExists()
            compose.onNodeWithText("导航").assertExists()
            capture("android-$theme-map-sheet-half")

            compose.onNodeWithContentDescription("展开到全屏").performClick()
            compose.waitUntil(10000) {
                compose.onAllNodesWithContentDescription("收起到半屏").fetchSemanticsNodes().isNotEmpty()
            }
            capture("android-$theme-map-sheet-full")
            compose.onNodeWithContentDescription("关闭地点详情").performClick()
            compose.waitUntil(10000) {
                compose.onAllNodesWithContentDescription("关闭地点详情").fetchSemanticsNodes().isEmpty()
            }

            // 4. Management: generate invite QR code
            compose.onNodeWithText("旅程设置", substring = false).performClick()
            waitText("邀请同行伙伴")
            compose.onNodeWithText("邀请同行伙伴").performScrollTo().performClick()
            waitText("生成邀请")
            compose.onNodeWithText("生成邀请").performClick()
            compose.waitUntil(15000) {
                compose.onAllNodesWithContentDescription("加入 $trip 的邀请二维码").fetchSemanticsNodes().isNotEmpty()
            }
            if (theme == "light") {
                val nodes = compose.onAllNodes(hasText("", substring = true)).fetchSemanticsNodes()
                val inviteCode =
                    nodes.flatMap { node ->
                        node.config.getOrNull(androidx.compose.ui.semantics.SemanticsProperties.Text)
                            .orEmpty()
                            .map { it.text }
                    }.firstOrNull { Regex("^[A-Za-z0-9_-]{18,}$").matches(it) }
                if (inviteCode != null) {
                    val dir = java.io.File(InstrumentationRegistry.getInstrumentation().targetContext.getExternalFilesDir(null), "acceptance").apply { mkdirs() }
                    java.io.File(dir, "android-invite-code.txt").writeText(inviteCode)
                }
            }
            capture("android-$theme-invite-qr")
            compose.onNodeWithText("关闭").performClick()
            compose.onNodeWithContentDescription("返回旅程列表").performClick()
            waitText(trip)
        }
    }
}
