package wang.jscloud.journey

import java.time.LocalDate
import java.time.temporal.ChronoUnit
import org.junit.Assert.*
import org.junit.Test

class DomainTest {
    @Test
    fun gcjAndWgsRoundTrip() {
        val gcj = Coordinates.toGcj(118.7969, 32.0603)
        assertTrue(kotlin.math.abs(gcj.first - 118.7969) > 0.001)
        val wgs = Coordinates.toWgs(gcj.first, gcj.second)
        assertEquals(118.7969, wgs.first, 0.0000001)
        assertEquals(32.0603, wgs.second, 0.0000001)
        assertEquals(2.3522 to 48.8566, Coordinates.toWgs(2.3522, 48.8566))
    }

    @Test
    fun preciseActivitiesStayInPreciseSlots() {
        fun activity(id: String, rank: Int, mode: String, start: String?) =
            obj(
                "id" to id,
                "kind" to "activity",
                "state" to "active",
                "payload" to
                    obj(
                        "dayId" to "d",
                        "order" to rank,
                        "time" to obj("mode" to mode, "start" to start),
                    ),
            )
        val rows =
            listOf(
                activity("pm", 0, "precise", "14:00"),
                activity("flex", 1024, "flexible", null),
                activity("am", 2048, "precise", "09:00"),
            )
        assertEquals(listOf("am", "flex", "pm"), orderedActivities(rows, "d").map { it.s("id") })
    }

    @Test
    fun moneyHasCurrencyPrecision() {
        assertEquals(1250L, parseMinor("12.50", "CNY"))
        assertEquals(1250L, parseMinor("1250", "JPY"))
        assertEquals(900L, parseMinor("900", "KRW"))
        assertEquals(0L, parseMinor("0", "CNY"))
        assertNull(parseMinor("", "CNY"))
    }

    @Test(expected = ArithmeticException::class)
    fun fractionalYenRejected() {
        parseMinor("1.5", "JPY")
    }

    @Test
    fun administrativeTimezone() {
        assertEquals("Asia/Shanghai", timezoneForAdcode("650100"))
        assertEquals("Asia/Hong_Kong", timezoneForAdcode("810000"))
        assertNull(timezoneForAdcode("000000"))
    }

    @Test
    fun datesAcrossDstAreCivilDays() {
        val a = LocalDate.parse("2026-03-07")
        val b = LocalDate.parse("2026-03-09")
        assertEquals(3, ChronoUnit.DAYS.between(a, b) + 1)
        assertEquals("plan-day-t-date-2026-03-08", planDayId("t", a.plusDays(1).toString(), 2))
    }

    private fun snapshot() =
        obj(
            "trip" to
                obj("id" to "trip", "state" to "active", "generation" to 0, "teamMode" to "equal"),
            "members" to
                org.json.JSONArray(listOf(obj("userId" to "me"), obj("userId" to "other"))),
            "objects" to
                org.json.JSONArray(
                    listOf(
                        obj(
                            "id" to "activity",
                            "kind" to "activity",
                            "state" to "active",
                            "generation" to 0,
                            "payload" to obj("dayId" to "old"),
                            "expressions" to org.json.JSONArray(),
                        )
                    )
                ),
        )

    private fun queued(
        kind: String,
        patch: org.json.JSONObject? = null,
        expression: org.json.JSONObject? = null,
    ) =
        obj(
            "tripId" to "trip",
            "operation" to
                obj(
                    "kind" to kind,
                    "objectId" to "activity",
                    "patch" to patch,
                    "expression" to expression,
                ),
        )

    @Test
    fun offlineDeleteRestoreTracksLifecycleGeneration() {
        val q = listOf(queued("delete"), queued("restore"))
        val s = projectSnapshot(snapshot(), q, "me")
        val a = s.a("objects").rows().first()
        assertEquals("active", a.s("state"))
        assertEquals(2, a.optInt("generation"))
        assertFalse(q.first().o("operation").has("generation"))
    }

    @Test
    fun participationProjectionAllowsUndo() {
        val s =
            projectSnapshot(
                snapshot(),
                listOf(queued("express", expression = obj("notParticipating" to true))),
                "me",
            )
        assertTrue(
            s.a("objects")
                .rows()
                .first()
                .a("expressions")
                .rows()
                .first()
                .optBoolean("notParticipating")
        )
        val undone =
            projectSnapshot(
                s,
                listOf(queued("express", expression = obj("notParticipating" to false))),
                "me",
            )
        assertFalse(
            undone
                .a("objects")
                .rows()
                .first()
                .a("expressions")
                .rows()
                .first()
                .optBoolean("notParticipating")
        )
    }

    @Test
    fun rescheduleProjectsStableDaysAndMoves() {
        val op =
            obj(
                "tripId" to "trip",
                "operation" to
                    obj(
                        "kind" to "reschedule",
                        "objectId" to "trip",
                        "patch" to
                            obj(
                                "startDate" to "2026-03-07",
                                "dayCount" to 3,
                                "moves" to
                                    org.json.JSONArray(
                                        listOf(obj("activityId" to "activity", "ordinal" to 2))
                                    ),
                            ),
                    ),
            )
        val s = projectSnapshot(snapshot(), listOf(op), "me")
        assertEquals(
            "plan-day-trip-date-2026-03-08",
            s.a("objects").rows().first().o("payload").s("dayId"),
        )
        assertEquals(3, s.a("objects").rows().count { it.s("kind") == "day" })
        assertEquals("2026-03-07", s.o("trip").s("startDate"))
    }

    @Test
    fun routeSignaturesMatchTheWebClient() {
        val text =
            javaClass.classLoader!!.getResourceAsStream("routes.json")!!.bufferedReader().use {
                it.readText()
            }
        org.json.JSONArray(text).rows().forEach { fixture ->
            assertEquals(
                fixture.s("name"),
                fixture.s("inputSignature"),
                routeSignature(fixture.o("from"), fixture.o("to"), fixture.s("mode")),
            )
        }
    }

    @Test
    fun invitationLinksUseTheActualQueryParameter() {
        assertEquals("code_A-1", normalizeInvite("https://journey.jscloud.wang/?invite=code_A-1"))
        assertEquals("code_A-1", normalizeInvite("code_A-1"))
    }
}
