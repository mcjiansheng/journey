package wang.jscloud.journey

import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class N1FeaturesTest {
    private fun makeDay(id: String, ordinal: Int, date: String?) =
        obj("id" to id, "kind" to "day", "state" to "active", "payload" to obj("ordinal" to ordinal, "date" to date))

    private fun makeActivity(
        id: String,
        dayId: String,
        order: Double,
        mode: String,
        start: String? = null,
        end: String? = null,
        endDayOffset: Int = 0,
    ) =
        obj(
            "id" to id,
            "kind" to "activity",
            "state" to "active",
            "payload" to
                obj(
                    "title" to id,
                    "dayId" to dayId,
                    "order" to order,
                    "time" to
                        obj(
                            "mode" to mode,
                            "period" to "",
                            "start" to start,
                            "end" to end,
                            "endDayOffset" to endDayOffset,
                        ),
                ),
        )

    @Test
    fun tripClockUsesDestinationTimezoneInsteadOfDeviceTimezone() {
        // 2026-12-01T15:30:00Z -> 2026-12-02 00:30 in Tokyo, 2026-12-01 10:30 in New York
        val instantMs = java.time.Instant.parse("2026-12-01T15:30:00Z").toEpochMilli()
        assertEquals(TripClock("2026-12-02", "00:30"), tripClockAt("Asia/Tokyo", instantMs))
        assertEquals(TripClock("2026-12-01", "10:30"), tripClockAt("America/New_York", instantMs))
        assertEquals(TripClock("2026-12-01", "23:30"), tripClockAt("Asia/Shanghai", instantMs))
    }

    @Test
    fun findTodayDayAndNextActivityMatchWebRules() {
        val day1 = makeDay("day-1", 1, "2026-12-01")
        val day2 = makeDay("day-2", 2, "2026-12-02")
        val dayUndated = makeDay("day-x", 3, null)
        val days = listOf(day1, day2, dayUndated)

        assertEquals("day-2", findTodayDay(days, "2026-12-02")?.s("id"))
        assertNull(findTodayDay(days, "2026-12-05"))

        val rows =
            listOf(
                makeActivity("flex-1", "day-2", 1.0, "flexible"),
                makeActivity("past", "day-2", 2.0, "precise", "08:00", "09:30"),
                makeActivity("exact-end", "day-2", 3.0, "precise", "09:00", "10:00"),
                makeActivity("future-no-end", "day-2", 4.0, "precise", "14:00", null),
                makeActivity("overnight", "day-2", 5.0, "precise", "22:00", "01:00", endDayOffset = 1),
            )

        // Not today -> null
        assertNull(findNextActivity(day1, rows, "2026-12-02", "09:00"))
        assertNull(findNextActivity(dayUndated, rows, "2026-12-02", "09:00"))
        // Boundary: end == clock still counts as not finished yet (matches >= clock in Itinerary.jsx)
        assertEquals("exact-end", findNextActivity(day2, rows, "2026-12-02", "10:00")?.s("id"))
        // After 10:00 -> jumps to future-no-end
        assertEquals("future-no-end", findNextActivity(day2, rows, "2026-12-02", "10:01")?.s("id"))
        // Late night -> overnight with endDayOffset > 0 stays eligible
        assertEquals("overnight", findNextActivity(day2, rows, "2026-12-02", "23:30")?.s("id"))
    }

    @Test
    fun normalizeInviteMatchesWebInviteCode() {
        assertEquals("code_A-1", normalizeInvite("  https://journey.jscloud.wang/?invite=code_A-1  "))
        assertEquals("code_A-1", normalizeInvite("https://journey.jscloud.wang/trips?foo=1&invite=code_A-1#top"))
        assertEquals("code B+2", normalizeInvite("https://journey.jscloud.wang/?invite=code%20B%2B2"))
        assertEquals("abc123", normalizeInvite("https://journey.jscloud.wang/join/abc123/"))
        assertEquals("abc123", normalizeInvite("https://journey.jscloud.wang/share/abc123?invite="))
        assertEquals("", normalizeInvite("https://journey.jscloud.wang/"))
        assertEquals("plain-code", normalizeInvite("  plain-code  "))
        assertEquals("not a url :// ???", normalizeInvite("not a url :// ???"))
    }

    @Test
    fun qrCodeRoundTripProducesInvitableUrl() {
        val inviteUrl = "http://127.0.0.1:4211/?invite=test_QR-code_99"
        val matrix = encodeQrMatrix(inviteUrl, 240)
        assertEquals(240, matrix.size)
        val luminance =
            ByteArray(matrix.size * matrix.size) { i ->
                if (matrix.bits[i]) 0x00.toByte() else 0xFF.toByte()
            }
        val decoded = decodeQrFromLuminance(luminance, matrix.size, matrix.size)
        assertEquals(inviteUrl, decoded)
        assertEquals("test_QR-code_99", normalizeInvite(decoded!!))
    }

    @Test
    fun deleteDayPermissionsAndDeletedTitlesMatchWebRules() {
        val equalTrip = obj("ownerId" to "u1", "teamMode" to "equal")
        val adminTrip = obj("ownerId" to "u1", "teamMode" to "admin")
        val members =
            listOf(
                obj("userId" to "u1", "isAdmin" to true),
                obj("userId" to "u2", "isAdmin" to true),
                obj("userId" to "u3", "isAdmin" to false),
            )
        assertTrue(canDeleteDirectly(equalTrip, members, "u1"))
        assertFalse(canDeleteDirectly(equalTrip, members, "u2"))
        assertTrue(canDeleteDirectly(adminTrip, members, "u2"))
        assertFalse(canDeleteDirectly(adminTrip, members, "u3"))

        val dayDated = obj("id" to "d1", "kind" to "day", "payload" to obj("ordinal" to 3, "date" to "2026-12-03"))
        val dayUndated = obj("id" to "d2", "kind" to "day", "payload" to obj("ordinal" to 4, "date" to JSONObject.NULL))
        val act1 = obj("id" to "a1", "kind" to "activity", "payload" to obj("title" to "中山陵"))
        val act2 = obj("id" to "a2", "kind" to "activity", "payload" to obj("title" to "明孝陵"))
        val route = obj("id" to "r1", "kind" to "route", "payload" to obj("fromId" to "a1", "toId" to "a2"))
        val objects = listOf(dayDated, dayUndated, act1, act2, route)

        assertEquals("2026-12-03", deletedObjectTitle(dayDated, objects))
        assertEquals("第 4 天", deletedObjectTitle(dayUndated, objects))
        assertEquals("中山陵 → 明孝陵", deletedObjectTitle(route, objects))
    }

    @Test
    fun fetchPlaceDetailParsesRestBizExtAndNormalizesInformation() {
        val server = MockWebServer()
        server.start()
        try {
            val api = JourneyApi(server.url("/").toString().trimEnd('/'), SessionCookies({ "[]" }, {}))
            server.enqueue(
                MockResponse()
                    .setBody(
                        JSONObject()
                            .put("status", "1")
                            .put(
                                "pois",
                                JSONArray().put(
                                    JSONObject()
                                        .put("id", "B00190BBCZ")
                                        .put("name", "南京博物院")
                                        .put("address", "中山东路321号")
                                        .put("location", "118.8254,32.0418")
                                        .put("type", "科教文化服务;博物馆;博物馆")
                                        .put("tel", "025-84807923")
                                        .put("website", JSONArray())
                                        .put("biz_ext", JSONObject().put("opentime2", "周二至周日 09:00-17:00"))
                                        .put(
                                            "photos",
                                            JSONArray().put(
                                                obj("title" to "主馆", "url" to "http://store.is.autonavi.com/showpic/njm")
                                            ),
                                        )
                                )
                            )
                            .toString()
                    )
            )
            val detail = fetchPlaceDetail(api, "B00190BBCZ")
            val request = server.takeRequest()
            assertEquals("/_AMapService/v3/place/detail?id=B00190BBCZ&extensions=all", request.path)
            assertNotNull(detail)
            val (place, info) = detail!!
            assertEquals("南京博物院", place.s("name"))
            assertFalse(place.has("information"))
            assertEquals("博物馆", info.type)
            assertEquals("周二至周日 09:00-17:00", info.openingHours)
            assertEquals("https://store.is.autonavi.com/showpic/njm", info.photo?.url)
            assertEquals("tel:02584807923", info.telephoneUrl)
            assertEquals("https://www.amap.com/place/B00190BBCZ", info.detailUrl)
        } finally {
            server.shutdown()
        }
    }
}
