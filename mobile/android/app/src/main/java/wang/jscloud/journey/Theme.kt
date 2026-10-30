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

private val LightPalette = JourneyPalette(
    dark = false,
    page = Color(0xFFEEF2EC),
    card = Color.White.copy(alpha = .65f),
    border = Color(0xFF829B88).copy(alpha = .18f),
    icon = Color(0xFFD9E4D2),
    text = Color(0xFF22332B),
    muted = Color(0xFF6B7A72),
    primary = Color(0xFF3A6B5A),
    onPrimary = Color.White,
    danger = Color(0xFFC9594F),
    selected = Color(0xFF7FCBA5).copy(alpha = .16f),
    secondary = Color.White.copy(alpha = .7f),
    elevated = Color(0xFFF7F9F5),
    ambientTop = Color(0xFFDDE7E7),
    ambientBottom = Color(0xFFF3EFDF),
    ambientMint = Color(0xFFDCEBDE),
)
private val DarkPalette = JourneyPalette(
    dark = true,
    page = Color(0xFF0F1613),
    card = Color.White.copy(alpha = .06f),
    border = Color.White.copy(alpha = .08f),
    icon = Color(0xFF22302A),
    text = Color(0xFFE6EEE9),
    muted = Color(0xFF93A39B),
    primary = Color(0xFF7FCBA5),
    onPrimary = Color(0xFF0E1F17),
    danger = Color(0xFFE5857D),
    selected = Color(0xFF7FCBA5).copy(alpha = .16f),
    secondary = Color.White.copy(alpha = .08f),
    elevated = Color(0xFF1C2721),
    ambientTop = Color(0xFF14201F),
    ambientBottom = Color(0xFF1A1D14),
    ambientMint = Color(0xFF142219),
)

val LocalJourneyPalette = staticCompositionLocalOf { LightPalette }

@Composable
fun JourneyTheme(store: JourneyStore, content: @Composable () -> Unit) {
    val preference = store.user?.o("preferences")?.s("theme", "system") ?: "system"
    val dark = preference == "dark" ||
        (preference == "system" && androidx.compose.foundation.isSystemInDarkTheme())
    val p = if (dark) DarkPalette else LightPalette
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
            glow(p.ambientTop, Offset(size.width, 0f), size.height * .7f)
            glow(p.ambientMint, Offset(0f, size.height * .3f), size.width * 1.1f)
            glow(p.ambientBottom, Offset(size.width * .4f, size.height), size.height * .65f)
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
