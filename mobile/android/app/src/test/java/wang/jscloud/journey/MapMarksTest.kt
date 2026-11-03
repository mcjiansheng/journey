package wang.jscloud.journey

import org.junit.Assert.*
import org.junit.Test
import org.json.JSONArray

class MapMarksTest {
    private fun points(distance: Double, mixed: Boolean = false, selected: Boolean = false) = listOf(ClusterPoint("a", 0.0, 0.0, "circle:blue", if (selected) 1 else 0), ClusterPoint("b", distance, 0.0, if (mixed) "triangle:coral" else "circle:blue"))
    @Test fun activityPlaceExcludesFavoriteAndRenderingFields() {
        val place = mapPlacePayload(obj("name" to "饭店", "lng" to 118.0, "lat" to 32.0, "mark" to obj("icon" to "triangle", "color" to "coral"), "_id" to "f", "_priority" to 1, "_sequence" to 2))
        assertEquals(setOf("name", "lng", "lat"), place.keys().asSequence().toSet())
    }
    @Test fun coordinateChangesSplitExistingCluster() {
        val grouped = clusterFavorites(points(20.0))
        assertEquals(2, clusterFavorites(points(100.0), grouped).size)
    }
    @Test fun thresholdsHysteresisAndSelectedPoint() {
        assertEquals(1, clusterFavorites(points(33.0)).size)
        assertEquals(2, clusterFavorites(points(35.0)).size)
        assertEquals(1, clusterFavorites(points(39.0), listOf(listOf("a", "b"))).size)
        assertEquals(2, clusterFavorites(points(41.0), listOf(listOf("a", "b"))).size)
        assertEquals(1, clusterFavorites(points(23.0, mixed = true)).size)
        assertEquals(2, clusterFavorites(points(25.0, mixed = true)).size)
        assertEquals(1, clusterFavorites(points(29.0, mixed = true), listOf(listOf("a", "b"))).size)
        assertEquals(2, clusterFavorites(points(31.0, mixed = true), listOf(listOf("a", "b"))).size)
        assertEquals(2, clusterFavorites(points(0.0, selected = true)).size)
    }
    @Test fun presetProjectionUpdatesFavoritesAndDeletionPreservesMark() {
        val old = obj("icon" to "triangle", "color" to "coral")
        val snapshot = obj("trip" to obj("id" to "t"), "objects" to JSONArray(listOf(obj("id" to "f", "kind" to "favorite", "payload" to obj("mark" to old)), obj("id" to "p", "kind" to "markPreset", "state" to "active", "payload" to old))))
        val patch = obj("tripId" to "t", "operation" to obj("kind" to "patch", "objectId" to "p", "patch" to obj("icon" to "circle")))
        val delete = obj("tripId" to "t", "operation" to obj("kind" to "delete", "objectId" to "p"))
        val result = projectSnapshot(snapshot, listOf(patch, delete), "u")
        assertEquals("circle", result.a("objects").rows()[0].o("payload").o("mark").s("icon"))
        assertEquals("coral", result.a("objects").rows()[0].o("payload").o("mark").s("color"))
    }
}
