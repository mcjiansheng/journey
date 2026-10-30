# 原生客户端配色

iOS 的 `Journey/Theme.swift` 与 Android 的 `Theme.kt` 按相同角色管理颜色。组件使用角色名，调色集中在主题文件；网页亮色样式保持原样。

| 角色 | 亮色 | 暗色 |
| --- | --- | --- |
| 页面 | `#EEF2EC` | `#0F1613` |
| 卡片 | 半透明白，约 65–68% | 白 6% |
| 主文字 | `#22332B` | `#E6EEE9` |
| 次文字 | `#6B7A72` | `#93A39B` |
| 主色 | `#3A6B5A` | `#7FCBA5` |
| 主按钮文字 | 白 | `#0E1F17` |
| 图标底色 | `#D9E4D2` | `#22302A` |
| 删除 | `#C9594F` | `#E5857D` |

页面用薄荷、右上青灰、底部暖色的径向渐变。卡片使用轻描边和 20–24 点圆角，内容至少保留 16 点内边距。创建和加入旅程使用次按钮；新增活动、保存等当前主要操作使用主按钮。活动删除移入更多菜单。

iOS 26 及以上通过 SwiftUI `.buttonStyle(.glass)` 和 `.glassEffect(.regular.tint(...).interactive())` 使用原生 Liquid Glass。主按钮和底部导航把玻璃放在独立背景层，文字、图标和选中底色使用主题角色，避免系统材质改写前景颜色。四个 NavigationStack 仍由同一个 TabView 保留状态；内容卡片使用统一的半透明表面。iOS 17–25 的按钮使用同色胶囊样式。Android 使用 Material 控件和悬浮胶囊导航。

原生玻璃 API 依据 [Apple：Build a SwiftUI app with the new design](https://developer.apple.com/videos/play/wwdc2025/323/)；所有版本分支集中在按钮样式中。
