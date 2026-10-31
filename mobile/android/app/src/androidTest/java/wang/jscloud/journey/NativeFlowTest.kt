package wang.jscloud.journey

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test

class NativeFlowTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()

    private fun waitText(text: String) {
        compose.waitUntil(30000) {
            compose
                .onAllNodesWithText(text, useUnmergedTree = true)
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
    fun r3LightAndDarkScreenshots() {
        val args = InstrumentationRegistry.getArguments()
        val identifier = args.getString("identifier")
        val password = args.getString("password")
        val trip = args.getString("tripName")
        assumeTrue("Pass fixture account and tripName", identifier != null && password != null && trip != null)
        compose.waitUntil(30000) {
            compose.onAllNodesWithText("邮箱或手机号").fetchSemanticsNodes().isNotEmpty() ||
                compose.onAllNodesWithContentDescription("个人设置").fetchSemanticsNodes().isNotEmpty()
        }
        if (compose.onAllNodesWithContentDescription("个人设置").fetchSemanticsNodes().isNotEmpty()) {
            compose.onNodeWithContentDescription("个人设置").performClick()
            compose.onNodeWithText("退出账号").performScrollTo().performClick()
            waitText("邮箱或手机号")
        }
        compose.onNodeWithText("邮箱或手机号").performTextInput(identifier!!)
        compose.onNodeWithText("密码").performTextInput(password!!)
        compose.onAllNodesWithText("登录").onLast().performClick()
        waitText(trip!!)
        for ((theme, choice) in listOf("light" to "浅色", "dark" to "深色")) {
            compose.onNodeWithContentDescription("个人设置").performClick()
            compose.onNodeWithText("外观").performClick()
            compose.onAllNodesWithText(choice).onLast().performClick()
            compose.onNodeWithText("保存设置").performClick()
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
            compose.onNodeWithText("管理", substring = false).performClick()
            waitText("旅程管理")
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
        compose.onNodeWithText("管理", substring = false).performClick()
        waitText("旅程管理")
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
}
