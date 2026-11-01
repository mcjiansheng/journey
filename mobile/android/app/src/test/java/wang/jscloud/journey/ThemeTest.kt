package wang.jscloud.journey

import androidx.compose.ui.graphics.Color
import org.junit.Assert.*
import org.junit.Test

class ThemeTest {
    @Test fun flatSurfacesKeepSelectionAndRemoveDecorationsInEveryPalette() {
        for (name in listOf("forest", "atlas")) for (dark in listOf(false, true)) {
            val normal = journeyPalette(name, dark)
            val flat = journeyPalette(name, dark, flat = true)
            assertEquals(normal.selected, flat.selected)
            assertNotEquals(flat.card, flat.selected)
            assertEquals(flat.card, flat.elevated)
            assertEquals(Color.Transparent, flat.highlight)
            assertEquals(Color.Transparent, flat.shadow)
            assertEquals(Color.Transparent, flat.ambientTop)
            assertEquals(Color.Transparent, flat.ambientBottom)
            assertEquals(Color.Transparent, flat.ambientMint)
            assertEquals(normal.text, flat.text)
            assertEquals(normal.border, flat.border)
        }
    }
    @Test fun atlasUsesBlueAndSolidBackdropWhileForestKeepsAmbientColors() {
        for (dark in listOf(false, true)) {
            val forest = journeyPalette("forest", dark)
            val atlas = journeyPalette("atlas", dark)
            assertNotEquals(forest.primary, atlas.primary)
            assertNotEquals(Color.Transparent, forest.ambientTop)
            assertEquals(Color.Transparent, atlas.ambientTop)
            assertEquals(Color.Transparent, atlas.ambientMint)
            assertEquals(Color.Transparent, atlas.ambientBottom)
        }
    }
}
