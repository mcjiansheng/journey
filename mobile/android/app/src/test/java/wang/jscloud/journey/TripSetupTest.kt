package wang.jscloud.journey

import org.junit.Assert.*
import org.junit.Test
import java.time.ZoneId

class TripSetupTest {
    @Test fun nameAndDestinationAreEnoughForDefaultCreation() {
        val form = createTripForm("  周末北京  ", " 北京 ", "2026-11-06", "2026-11-08")
        assertEquals("周末北京", form.s("name"))
        assertEquals("北京", form.s("destination"))
        assertEquals("admin", form.s("teamMode"))
        assertEquals(ZoneId.systemDefault().id, form.s("timezone"))
        assertEquals("CNY", form.s("currency"))
        assertEquals(3, form.getInt("dayCount"))
    }

    @Test fun selectedTeamAndManualSettingsAreSubmittedAsSelected() {
        val form = createTripForm("东京", "东京", "2026-11-06", "2026-11-06",
            "Asia/Tokyo", "JPY", "equal")
        assertEquals("equal", form.s("teamMode"))
        assertEquals("Asia/Tokyo", form.s("timezone"))
        assertEquals("JPY", form.s("currency"))
        assertEquals(1, form.getInt("dayCount"))
    }

    @Test fun timezonePickerHasChineseLabelsAndValidIdentifiers() {
        tripTimezones.forEach { (id, label) ->
            assertEquals(id, ZoneId.of(id).id)
            assertTrue(label.any { it.code in 0x4e00..0x9fff })
        }
        assertEquals("中国大陆 · 北京、上海", timezoneLabel("Asia/Shanghai"))
    }

    @Test fun beijingResolvesWithoutNetwork() {
        assertEquals("Asia/Shanghai", knownDestinationTimezone("北京"))
        assertEquals("Asia/Shanghai", knownDestinationTimezone("北京市"))
    }

    @Test fun timezoneSearchIncludesDestinationsOutsideTheCommonList() {
        assertFalse(tripTimezones.containsKey("Africa/Nairobi"))
        val matches = searchTripTimezones("Nairobi")
        assertTrue(matches.containsKey("Africa/Nairobi"))
        assertFalse(matches.getValue("Africa/Nairobi").contains("Africa/"))
        assertEquals(tripTimezones, searchTripTimezones(""))
    }

    @Test fun creationResponsePopulatesTripListWithoutAnotherRequest() {
        val response = obj("trip" to obj("id" to "new-trip", "name" to "北京周末"),
            "members" to org.json.JSONArray(listOf(obj("userId" to "me", "displayName" to "小林"))))
        val list = tripsWithCreatedTrip(listOf(obj("id" to "old-trip", "name" to "旧旅程")), response)
        assertEquals(listOf("new-trip", "old-trip"), list.map { it.s("id") })
        assertEquals("小林", list.first().a("members").getJSONObject(0).s("displayName"))
        assertFalse(list.first().getBoolean("archived"))
        assertFalse(response.o("trip").has("archived"))
    }

    @Test fun acceptingSameCreationSnapshotDoesNotDuplicateTripInList() {
        val response = obj("trip" to obj("id" to "new-trip", "name" to "北京周末"), "members" to org.json.JSONArray())
        val once = tripsWithCreatedTrip(emptyList(), response)
        val twice = tripsWithCreatedTrip(once, response)
        assertEquals(1, twice.size)
        assertEquals("new-trip", twice.single().s("id"))
    }
}
