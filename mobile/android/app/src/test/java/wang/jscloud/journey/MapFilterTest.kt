package wang.jscloud.journey

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class MapFilterTest {
    private val itinerary = Fixtures.load("itinerary.json")

    private fun testPlace(
        name: String,
        lng: Double?,
        lat: Double?,
        category: String = "",
        providerPlaceId: String? = null,
        mark: JSONObject? = null,
    ): JSONObject =
        obj(
            "name" to name,
            "address" to "南京",
            "lng" to lng,
            "lat" to lat,
            "provider" to if (providerPlaceId != null) "amap" else null,
            "providerPlaceId" to providerPlaceId,
            "category" to category,
            "sourceUrl" to "",
            "fetchedAt" to null,
            "coordSystem" to "GCJ-02",
        ).apply {
            if (mark != null) put("mark", mark) else put("mark", JSONObject.NULL)
        }

    private fun testSnapshot(): JSONObject {
        val cafe = testPlace("咖啡馆", 118.81, 32.05, category = "咖啡店；餐饮", mark = obj("icon" to "circle", "color" to "coral"))
        val museum = testPlace("南京博物院", 118.825, 32.042, category = "景点；博物馆", providerPlaceId = "B0019", mark = obj("icon" to "triangle", "color" to "blue"))
        val hotel = testPlace("湖畔酒店", 118.79, 32.06, category = "观景酒店") // mark == null (unclassified)
        val station = testPlace("南京站", 118.798, 32.087, category = "交通；火车站", mark = obj("icon" to "circle", "color" to "coral"))
        val unlocated = testPlace("无坐标地点", null, null, category = "其他", mark = obj("icon" to "star", "color" to "amber"))

        val day1 = obj("id" to "day-1", "kind" to "day", "state" to "active", "payload" to obj("ordinal" to 1, "date" to "2026-12-01"))
        val day2 = obj("id" to "day-2", "kind" to "day", "state" to "active", "payload" to obj("ordinal" to 2, "date" to "2026-12-02"))
        val dayDeleted = obj("id" to "day-del", "kind" to "day", "state" to "deleted", "payload" to obj("ordinal" to 3, "date" to "2026-12-03"))

        val act1 = obj(
            "id" to "act-1",
            "kind" to "activity",
            "state" to "active",
            "payload" to obj(
                "title" to "逛博物院",
                "dayId" to "day-1",
                "order" to 1,
                "time" to obj("mode" to "precise", "start" to "09:00", "end" to "11:00"),
                "place" to museum.copyJson().apply { remove("mark") },
            ),
        )
        val act2 = obj(
            "id" to "act-2",
            "kind" to "activity",
            "state" to "active",
            "payload" to obj(
                "title" to "车站集合",
                "dayId" to "day-1",
                "order" to 2,
                "time" to obj("mode" to "precise", "start" to "12:00", "end" to "12:30"),
                "place" to station.copyJson().apply { remove("mark") },
            ),
        )
        val act3 = obj(
            "id" to "act-3",
            "kind" to "activity",
            "state" to "active",
            "payload" to obj(
                "title" to "第二天上午",
                "dayId" to "day-2",
                "order" to 1,
                "time" to obj("mode" to "flexible", "period" to "上午"),
                "place" to testPlace("中山陵", 118.85, 32.06, category = "风景名胜"),
            ),
        )
        val actOnDeletedDay = obj(
            "id" to "act-del-day",
            "kind" to "activity",
            "state" to "active",
            "payload" to obj(
                "title" to "已删天的活动",
                "dayId" to "day-del",
                "order" to 1,
                "time" to obj("mode" to "flexible", "period" to ""),
                "place" to hotel.copyJson().apply { remove("mark") },
            ),
        )

        val fav1 = obj("id" to "fav-1", "kind" to "favorite", "state" to "active", "payload" to cafe)
        val fav2 = obj("id" to "fav-2", "kind" to "favorite", "state" to "active", "payload" to museum)
        val fav3 = obj("id" to "fav-3", "kind" to "favorite", "state" to "active", "payload" to hotel)
        val fav4 = obj("id" to "fav-4", "kind" to "favorite", "state" to "active", "payload" to station)
        val fav5 = obj("id" to "fav-5", "kind" to "favorite", "state" to "active", "payload" to unlocated)
        val favDeleted = obj(
            "id" to "fav-del",
            "kind" to "favorite",
            "state" to "deleted",
            "payload" to testPlace("已删收藏", 118.7, 32.0, mark = obj("icon" to "square", "color" to "purple")),
        )

        val presetFood = obj("id" to "p-food", "kind" to "markPreset", "state" to "active", "payload" to obj("icon" to "circle", "color" to "coral", "name" to "必吃", "order" to 0))
        val presetSight = obj("id" to "p-sight", "kind" to "markPreset", "state" to "active", "payload" to obj("icon" to "triangle", "color" to "blue", "name" to "打卡", "order" to 1024))
        val presetDefault = obj("id" to "p-star", "kind" to "markPreset", "state" to "active", "payload" to obj("icon" to "star", "color" to "amber", "name" to "待定", "order" to 2048))
        val presetUnused = obj("id" to "p-unused", "kind" to "markPreset", "state" to "active", "payload" to obj("icon" to "flag", "color" to "green", "name" to "未使用", "order" to 3072))
        val presetUnnamed = obj("id" to "p-deleted", "kind" to "markPreset", "state" to "deleted", "payload" to obj("icon" to "square", "color" to "purple", "name" to "已删预设", "order" to 4096))

        val route12 = obj(
            "id" to "route-12",
            "kind" to "route",
            "state" to "active",
            "payload" to obj(
                "fromId" to "act-1",
                "toId" to "act-2",
                "mode" to "walking",
                "minutes" to 25,
                "manual" to false,
                "inputSignature" to routeSignature(act1, act2, "walking"),
                "path" to JSONArray(listOf(JSONArray(listOf(118.825, 32.042)), JSONArray(listOf(118.798, 32.087)))),
            ),
        )
        val routeStale = obj(
            "id" to "route-stale",
            "kind" to "route",
            "state" to "active",
            "payload" to obj(
                "fromId" to "act-1",
                "toId" to "act-2",
                "mode" to "driving",
                "minutes" to 10,
                "manual" to false,
                "inputSignature" to "stale",
                "path" to JSONArray(listOf(JSONArray(listOf(118.825, 32.042)), JSONArray(listOf(118.798, 32.087)))),
            ),
        )

        return obj(
            "trip" to obj(
                "id" to "trip-1",
                "startDate" to "2026-12-01",
                "dayCount" to 3,
            ),
            "objects" to JSONArray(
                listOf(
                    day1,
                    day2,
                    dayDeleted,
                    act1,
                    act2,
                    act3,
                    actOnDeletedDay,
                    fav1,
                    fav2,
                    fav3,
                    fav4,
                    fav5,
                    favDeleted,
                    presetFood,
                    presetSight,
                    presetDefault,
                    presetUnused,
                    presetUnnamed,
                    route12,
                    routeStale,
                )
            ),
        )
    }

    @Test
    fun visibleDaysAndDayLabelMatchWebFixtures() {
        val visibleCases = Fixtures.cases(itinerary, "visibleDays", "domain")
        assertTrue(visibleCases.isNotEmpty())
        for (c in visibleCases) {
            val expected = (c.result as JSONArray).rows().map { it.s("id") }
            val actual = visibleDays(c.args.getJSONObject(0)).map { it.s("id") }
            assertEquals(expected, actual)
        }

        val labelCases = Fixtures.cases(itinerary, "dayLabel", "domain")
        assertTrue(labelCases.isNotEmpty())
        for (c in labelCases) {
            assertEquals(
                c.result,
                dayLabel(c.args.getJSONObject(0), c.args.optJSONObject(1)),
            )
        }
    }

    @Test
    fun markKeysKeepUnclassifiedFavoritesOutOfPresetFilters() {
        assertEquals("default", markKey(null))
        assertEquals("default", markKey(obj()))
        assertEquals("star:amber", markKey(defaultMark()))
        assertEquals("琥珀星", markLabel(defaultMark()))
        assertNull(rawMark(obj("name" to "无标记", "mark" to JSONObject.NULL)))
        assertEquals("star:amber", markKey(effectiveMark(obj("name" to "无标记"))))

        val snap = testSnapshot()
        val data = filterMapData(snap, MapFilterState())
        // fav-5 (unlocated) has star:amber -> count 1; fav-3 has mark: null -> must NOT match star:amber preset!
        assertEquals(listOf("circle:coral", "triangle:blue", "star:amber"), data.legend.map { it.key })
        assertEquals(listOf(2, 1, 1), data.legend.map { it.count })

        val starFiltered = filterMapData(snap, MapFilterState(mark = "star:amber"))
        assertEquals(listOf("fav-5"), starFiltered.visibleFavorites.map { it.s("id") })
    }

    @Test
    fun placeCategoryAndKeyMatchWebRules() {
        assertEquals("餐饮", placeCategory(obj("category" to "咖啡店；景点")))
        assertEquals("住宿", placeCategory(obj("category" to "观景酒店")))
        assertEquals("景点", placeCategory(obj("category" to "历史文化公园")))
        assertEquals("交通", placeCategory(obj("category" to "火车站")))
        assertEquals("其他", placeCategory(obj("category" to "")))
        assertEquals("其他", placeCategory(null))

        val a = obj("name" to "X", "address" to "A", "lng" to 118, "lat" to 32)
        val b = obj("name" to "X", "address" to "A", "lng" to 118.0, "lat" to 32.0)
        assertEquals(placeKey(a), placeKey(b))
        assertEquals(
            "amap:B001",
            placeKey(obj("name" to "One", "providerPlaceId" to "B001")),
        )
        assertFalse(placeLocated(obj("name" to "X", "lng" to JSONObject.NULL, "lat" to 32.0)))
        assertTrue(placeLocated(obj("name" to "X", "lng" to 118.0, "lat" to 32.0)))
    }

    @Test
    fun legendCountsStayBasedOnAllActiveFavoritesAndClearStaleFilter() {
        val snap = testSnapshot()
        val filtered =
            filterMapData(
                snap,
                MapFilterState(layer = "收藏", category = "餐饮", arranged = "未安排", mark = "circle:coral"),
            )
        // Only fav-1 (咖啡馆) matches category=餐饮 & arranged=未安排 & mark=circle:coral
        assertEquals(listOf("fav-1"), filtered.visibleFavorites.map { it.s("id") })
        // Legend count for circle:coral remains 2 (fav-1 + fav-4), unaffected by category/arranged/mark filters
        val coralLegend = filtered.legend.first { it.key == "circle:coral" }
        assertEquals(2, coralLegend.count)
        assertEquals("必吃", coralLegend.name)

        // Deleted or non-existent preset clears effectiveMarkFilter
        val stale = filterMapData(snap, MapFilterState(mark = "square:purple"))
        assertNull(stale.effectiveMarkFilter)
        assertEquals(5, stale.visibleFavorites.size)
    }

    @Test
    fun unnamedPresetFallsBackToMarkLabelInLegend() {
        val snap =
            obj(
                "trip" to obj("id" to "t", "startDate" to "2026-12-01", "dayCount" to 1),
                "objects" to
                    JSONArray(
                        listOf(
                            obj("id" to "p1", "kind" to "markPreset", "state" to "active", "payload" to obj("icon" to "heart", "color" to "rose", "name" to "")),
                            obj("id" to "f1", "kind" to "favorite", "state" to "active", "payload" to testPlace("店", 118.0, 32.0, mark = obj("icon" to "heart", "color" to "rose"))),
                        )
                    ),
            )
        val data = filterMapData(snap, MapFilterState())
        assertEquals(1, data.legend.size)
        assertEquals("玫红心", data.legend[0].name)
    }

    @Test
    fun layerCategoryArrangedAndRouteCombinationsMatchMapView() {
        val snap = testSnapshot()

        // Default ("全部"): activities take precedence over same-place favorites; fav-5 unlocated excluded from markers
        val all = filterMapData(snap, MapFilterState(), routeDayId = "day-1")
        assertEquals(listOf("act-1", "act-2"), all.activityMarkers.map { it.activity.s("id") })
        assertEquals(listOf(1, 2), all.activityMarkers.map { it.order })
        assertEquals(listOf("fav-1", "fav-3"), all.favoriteMarkers.map { it.s("id") })
        assertEquals(listOf("route-12"), all.routes.map { it.s("id") })

        // Layer = "行程": hides all favorites, keeps activities & routes
        val itineraryOnly = filterMapData(snap, MapFilterState(layer = "行程"), routeDayId = "day-1")
        assertTrue(itineraryOnly.favoriteMarkers.isEmpty())
        assertEquals(listOf("act-1", "act-2"), itineraryOnly.activityMarkers.map { it.activity.s("id") })
        assertEquals(listOf("route-12"), itineraryOnly.routes.map { it.s("id") })

        // Layer = "收藏": hides all activities and NEVER draws routes; previously shadowed fav-2 & fav-4 become favoriteMarkers
        val favoritesOnly = filterMapData(snap, MapFilterState(layer = "收藏"), routeDayId = "day-1")
        assertTrue(favoritesOnly.activityMarkers.isEmpty())
        assertTrue(favoritesOnly.routes.isEmpty())
        assertEquals(listOf("fav-1", "fav-2", "fav-3", "fav-4"), favoritesOnly.favoriteMarkers.map { it.s("id") })

        // Arranged = "已安排": fav-3 is only on deleted day-del so it is NOT arranged
        val arranged = filterMapData(snap, MapFilterState(arranged = "已安排"), routeDayId = "day-1")
        assertEquals(listOf("fav-2", "fav-4"), arranged.visibleFavorites.map { it.s("id") })
        assertEquals(listOf("act-1", "act-2"), arranged.activityMarkers.map { it.activity.s("id") })
        assertEquals(listOf("route-12"), arranged.routes.map { it.s("id") })

        // Arranged = "未安排": hides all activities and routes
        val unarranged = filterMapData(snap, MapFilterState(arranged = "未安排"), routeDayId = "day-1")
        assertEquals(listOf("fav-1", "fav-3", "fav-5"), unarranged.visibleFavorites.map { it.s("id") })
        assertTrue(unarranged.activityMarkers.isEmpty())
        assertTrue(unarranged.routes.isEmpty())

        // Category = "景点": filters both activities and favorites; route-12 breaks because act-2 (交通) is filtered out
        val sight = filterMapData(snap, MapFilterState(category = "景点"), routeDayId = "day-1")
        assertEquals(listOf("fav-2"), sight.visibleFavorites.map { it.s("id") })
        assertEquals(listOf("act-1"), sight.activityMarkers.map { it.activity.s("id") })
        assertTrue(sight.routes.isEmpty())

        // Selected place is excluded from favoriteMarkers/activityMarkers
        val withSelected =
            filterMapData(
                snap,
                MapFilterState(),
                routeDayId = "day-1",
                selectedPlace = obj("name" to "咖啡馆", "address" to "南京", "lng" to 118.81, "lat" to 32.05),
            )
        assertEquals(listOf("fav-3"), withSelected.favoriteMarkers.map { it.s("id") })
    }
}
