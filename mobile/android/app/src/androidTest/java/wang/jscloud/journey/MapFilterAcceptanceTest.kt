package wang.jscloud.journey

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test

class MapFilterAcceptanceTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()

    private fun waitText(text: String, substring: Boolean = false, timeoutMillis: Long = 30000) {
        compose.waitUntil(timeoutMillis) {
            compose
                .onAllNodesWithText(text, substring = substring, useUnmergedTree = true)
                .fetchSemanticsNodes()
                .isNotEmpty()
        }
    }

    private fun capture(name: String) {
        compose.waitForIdle()
        val instrumentation = InstrumentationRegistry.getInstrumentation()
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
    fun mapFilterAndLegendScreenshotsAndSync() {
        val args = InstrumentationRegistry.getArguments()
        val identifier = args.getString("identifier")
        val password = args.getString("password")
        val trip = args.getString("tripName")
        val mutateFavorite = args.getString("mutateFavorite")
        val mutatePreset = args.getString("mutatePreset")
        assumeTrue(
            "Pass fixture identifier, password and tripName",
            identifier != null && password != null && trip != null,
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
        compose.onNodeWithText(trip).performClick()
        waitText("行程")

        for ((theme, choice) in listOf("light" to "浅色", "dark" to "深色")) {
            compose.onNodeWithContentDescription("我的设置").performClick()
            waitText("外观")
            compose.onNodeWithText("外观").performClick()
            compose.onAllNodesWithText(choice).onLast().performClick()
            compose.waitUntil(10000) {
                compose.onAllNodesWithText("完成").fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithText("完成").performClick()
            compose.waitUntil(10000) {
                compose.onAllNodes(isDialog()).fetchSemanticsNodes().isEmpty()
            }

            compose.onNodeWithText("地图", substring = false).performClick()
            waitText("我的收藏")
            compose.waitUntil(45000) {
                compose.onAllNodesWithTag("journey-map-ready").fetchSemanticsNodes().isNotEmpty() ||
                    compose
                        .onAllNodesWithText("地图加载失败：", substring = true)
                        .fetchSemanticsNodes()
                        .isNotEmpty()
            }
            compose.waitUntil(15000) {
                compose.onAllNodesWithTag("map-filter-button").fetchSemanticsNodes().isNotEmpty()
            }
            capture("android-$theme-map-legend")

            if (
                compose.onAllNodesWithTag("map-legend-button").fetchSemanticsNodes().isNotEmpty()
            ) {
                compose.onNodeWithTag("map-legend-button").performClick()
                waitText("标记图例")
                capture("android-$theme-legend-sheet")
                compose.onNodeWithText("关闭").performClick()
                compose.waitUntil(10000) {
                    compose.onAllNodesWithText("标记图例").fetchSemanticsNodes().isEmpty()
                }
            }

            compose.onNodeWithTag("map-filter-button").performClick()
            waitText("筛选地点")
            capture("android-$theme-filter-sheet")
            compose.onNodeWithText("取消").performClick()
            compose.waitUntil(10000) {
                compose.onAllNodesWithText("筛选地点").fetchSemanticsNodes().isEmpty()
            }
        }

        // Verify filter behavior in UI and optionally apply a preset from Android for web verification.
        compose.onNodeWithTag("map-filter-button").performClick()
        waitText("筛选地点")
        compose.onAllNodesWithText("收藏").onLast().performClick()
        compose.onNodeWithTag("map-filter-apply").performClick()
        compose.waitUntil(10000) {
            compose.onAllNodesWithText("筛选 · 1").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("map-filter-button").performClick()
        waitText("筛选地点")
        compose.onNodeWithText("重置").performClick()
        compose.onNodeWithTag("map-filter-apply").performClick()
        compose.waitUntil(10000) {
            compose.onAllNodesWithText("筛选", substring = false).fetchSemanticsNodes().isNotEmpty()
        }

        if (!mutateFavorite.isNullOrBlank() && !mutatePreset.isNullOrBlank()) {
            compose.onNodeWithText(mutateFavorite, substring = true).performScrollTo().performClick()
            waitText(mutatePreset, substring = true)
            compose.onAllNodesWithText(mutatePreset, substring = true).onFirst().performScrollTo().performClick()
            compose.waitUntil(15000) {
                compose
                    .onAllNodesWithContentDescription("已同步，保存与同步")
                    .fetchSemanticsNodes()
                    .isNotEmpty()
            }
        }
    }
}
