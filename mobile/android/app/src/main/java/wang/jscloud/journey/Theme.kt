package wang.jscloud.journey

import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.activity.compose.LocalActivity
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

@Immutable
data class JourneyPalette(
    val dark: Boolean,
    val reducedTransparency: Boolean,
    val reducedMotion: Boolean,
    val highlight: Color,
    val shadow: Color,
    val page: Color,
    val card: Color,
    val border: Color,
    val icon: Color,
    val text: Color,
    val muted: Color,
    val primary: Color,
    val onPrimary: Color,
    val danger: Color,
    val selected: Color,
    val secondary: Color,
    val elevated: Color,
    val ambientTop: Color,
    val ambientBottom: Color,
    val ambientMint: Color,
)

internal fun journeyPalette(name: String, dark: Boolean, flat: Boolean = false, reducedMotion: Boolean = false): JourneyPalette {
    val colors = DesignTokens.palette(name, dark)
    return JourneyPalette(
        dark = dark, reducedTransparency = flat, reducedMotion = reducedMotion,
        page = colors.page, card = colors.surface, border = colors.border,
        icon = colors.iconBackground, text = colors.text, muted = colors.muted,
        primary = colors.primary, onPrimary = colors.onPrimary, danger = colors.danger,
        selected = colors.selected, secondary = if (flat) colors.surface else colors.elevated,
        elevated = if (flat) colors.surface else colors.elevated,
        highlight = if (flat) Color.Transparent else colors.highlight,
        shadow = if (flat) Color.Transparent else colors.shadow,
        ambientTop = if (flat) Color.Transparent else colors.ambientSky,
        ambientBottom = if (flat) Color.Transparent else colors.ambientLow,
        ambientMint = if (flat) Color.Transparent else colors.ambientMint,
    )
}

val LocalJourneyPalette = staticCompositionLocalOf { journeyPalette("forest", false) }

@Composable
fun JourneyTheme(store: JourneyStore, content: @Composable () -> Unit) {
    val preference = store.user?.o("preferences")?.s("theme", "system") ?: "system"
    val dark = preference == "dark" ||
        (preference == "system" && androidx.compose.foundation.isSystemInDarkTheme())
    val preferences = store.user?.o("preferences")
    val context = androidx.compose.ui.platform.LocalContext.current
    var systemReducedMotion by remember { mutableStateOf(false) }
    DisposableEffect(context) {
        fun update() {
            systemReducedMotion = android.provider.Settings.Global.getFloat(
                context.contentResolver, android.provider.Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
        }
        val observer = object : android.database.ContentObserver(android.os.Handler(android.os.Looper.getMainLooper())) {
            override fun onChange(selfChange: Boolean) = update()
        }
        update()
        context.contentResolver.registerContentObserver(android.provider.Settings.Global.getUriFor(
            android.provider.Settings.Global.ANIMATOR_DURATION_SCALE), false, observer)
        onDispose { context.contentResolver.unregisterContentObserver(observer) }
    }
    val reducedMotion = when (preferences?.opt("reducedMotion")) {
        true -> true
        false -> false
        else -> systemReducedMotion
    }
    val p = journeyPalette(preferences?.s("palette", "forest") ?: "forest", dark,
        preferences?.opt("reducedTransparency") == true, reducedMotion)
    val activity = LocalActivity.current as? ComponentActivity
    SideEffect {
        activity?.enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.auto(p.page.toArgb(), p.page.toArgb()) { dark },
            navigationBarStyle = SystemBarStyle.auto(p.page.toArgb(), p.page.toArgb()) { dark },
        )
    }
    val base = if (dark) darkColorScheme() else lightColorScheme()
    val colors = base.copy(
        primary = p.primary, onPrimary = p.onPrimary,
        secondary = p.primary, onSecondary = p.onPrimary,
        tertiary = p.primary, onTertiary = p.onPrimary,
        primaryContainer = p.selected, onPrimaryContainer = p.primary,
        secondaryContainer = p.selected, onSecondaryContainer = p.primary,
        tertiaryContainer = p.selected, onTertiaryContainer = p.primary,
        background = p.page, onBackground = p.text,
        surface = p.elevated, onSurface = p.text,
        surfaceVariant = p.icon, onSurfaceVariant = p.muted,
        surfaceContainerLowest = p.page, surfaceContainerLow = p.elevated,
        surfaceContainer = p.elevated, surfaceContainerHigh = p.elevated,
        surfaceContainerHighest = p.icon, surfaceTint = Color.Transparent,
        outline = p.border, outlineVariant = p.border,
        error = p.danger, onError = p.onPrimary,
        errorContainer = p.danger.copy(alpha = .16f), onErrorContainer = p.danger,
        inverseSurface = p.text, inverseOnSurface = p.page, inversePrimary = p.onPrimary,
    )
    CompositionLocalProvider(LocalJourneyPalette provides p) {
        MaterialTheme(
            colorScheme = colors,
            shapes = Shapes(
                extraSmall = RoundedCornerShape(10.dp), small = RoundedCornerShape(14.dp),
                medium = RoundedCornerShape(20.dp), large = RoundedCornerShape(24.dp),
                extraLarge = RoundedCornerShape(28.dp),
            ),
            content = { CompositionLocalProvider(LocalContentColor provides p.text, content = content) },
        )
    }
}

@Composable
fun JourneyBackdrop(content: @Composable () -> Unit) {
    val p = LocalJourneyPalette.current
    Box(Modifier.fillMaxSize()) {
        Canvas(Modifier.matchParentSize()) {
            drawRect(p.page)
            fun glow(color: Color, center: Offset, radius: Float) {
                drawRect(Brush.radialGradient(listOf(color, color.copy(alpha = 0f)), center, radius))
            }
            if (!p.reducedTransparency) {
            val glowScale = if (p.dark) 1.4f else 1f
            glow(p.ambientTop, Offset(size.width, 0f), size.height * .7f * glowScale)
            glow(p.ambientMint, Offset(0f, size.height * .3f), size.width * 1.1f * glowScale)
            glow(p.ambientBottom, Offset(size.width * .4f, size.height), size.height * .65f * glowScale)
            }
        }
        content()
    }
}

@Composable
fun SecondaryButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    content: @Composable RowScope.() -> Unit,
) {
    val p = LocalJourneyPalette.current
    OutlinedButton(
        onClick = onClick, modifier = modifier, enabled = enabled,
        border = BorderStroke(1.dp, p.border),
        colors = ButtonDefaults.outlinedButtonColors(containerColor = p.secondary, contentColor = p.primary),
        content = content,
    )
}
