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
        waitText("一起走过的每一天")
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
        compose.onNodeWithText("保存费用").performScrollTo().performClick()
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
        compose.onNodeWithText("保存活动").performScrollTo().performClick()
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
