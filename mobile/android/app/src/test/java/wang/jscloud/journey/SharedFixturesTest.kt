package wang.jscloud.journey

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

/**
 * Shared fixtures from mobile/fixtures, generated from the web client by
 * mobile/tools/generate-fixtures.mjs (docs/设计文档/11-原生端功能对齐.md §4).
 *
 * Each later work package ports a web function and adds a test here that replays
 * `Fixtures.cases(file, "<fn>")` through the port and checks it with `Fixtures.same`.
 */
object Fixtures {
    val files = listOf("rich-text.json", "board-geometry.json", "board-widgets.json", "itinerary.json", "place-information.json")

    fun load(name: String): JSONObject =
        JSONObject(
            Fixtures::class.java.classLoader!!.getResourceAsStream(name)!!.bufferedReader().use {
                it.readText()
            }
        )

    class Case(val args: JSONArray, val result: Any?)

    /**
     * Successful cases of one function. An argument "$snapshot" stands for the file's
     * top-level `snapshot`; "$fn:simplify" for a callback the caller passes in itself.
     */
    fun cases(file: JSONObject, fn: String, module: String? = null): List<Case> =
        file.a("cases").rows()
            .filter { it.s("fn") == fn && (module == null || it.s("module") == module) && !it.has("error") }
            .map { c ->
                val raw = c.a("args")
                val args = JSONArray()
                for (i in 0 until raw.length()) {
                    val a = raw.get(i)
                    args.put(
                        if (a is String && a.startsWith("\$") && !a.startsWith("\$fn:")) file.get(a.substring(1))
                        else a
                    )
                }
                Case(args, c.opt("result"))
            }

    /** Deep JSON equality; numbers may differ by 1e-9. */
    fun same(expected: Any?, actual: Any?): Boolean {
        val e = expected ?: JSONObject.NULL
        val a = actual ?: JSONObject.NULL
        return when {
            e is Number && a is Number -> Math.abs(e.toDouble() - a.toDouble()) <= 1e-9
            e is JSONObject && a is JSONObject -> {
                val keys = e.keys().asSequence().toSet()
                keys == a.keys().asSequence().toSet() && keys.all { same(e.get(it), a.get(it)) }
            }
            e is JSONArray && a is JSONArray ->
                e.length() == a.length() && (0 until e.length()).all { same(e.get(it), a.get(it)) }
            else -> e == a
        }
    }
}

class SharedFixturesTest {
    private val itinerary = Fixtures.load("itinerary.json")
    private val snapshotObjects = itinerary.o("snapshot").a("objects").rows()

    @Test
    fun everyFixtureFileIsGeneratedAndHasCases() {
        for (name in Fixtures.files) {
            val file = Fixtures.load(name)
            assertTrue(name, file.s("\$comment").contains("generate-fixtures.mjs"))
            assertTrue(name, file.a("cases").length() > 0)
        }
    }

    @Test
    fun deletedContentListsOnlyKindsTheWebClientRestores() {
        // The snapshot also holds a deleted board, which this client must not list.
        assertEquals(
            listOf("day-3", "act-5", "fav-4", "exp-5"),
            deletedContent(snapshotObjects).map { it.s("id") },
        )
    }

    @Test
    fun orderedActivitiesMatchTheWebClient() {
        val cases = Fixtures.cases(itinerary, "orderedActivities", "domain")
        assertTrue(cases.isNotEmpty())
        for (c in cases) {
            val dayId = c.args.getString(1)
            val expected = (c.result as JSONArray).rows().map { it.s("id") }
            assertEquals(dayId, expected, orderedActivities(snapshotObjects, dayId).map { it.s("id") })
        }
    }

    @Test
    fun routeSignaturesMatchTheWebClientForTheSharedSnapshot() {
        val cases = Fixtures.cases(itinerary, "routeSignature", "domain")
        assertTrue(cases.isNotEmpty())
        for (c in cases)
            assertEquals(
                c.result,
                routeSignature(c.args.getJSONObject(0), c.args.getJSONObject(1), c.args.getString(2)),
            )
    }

    @Test
    fun safePlaceUrlMatchesTheWebClient() {
        val file = Fixtures.load("place-information.json")
        val cases = Fixtures.cases(file, "safePlaceUrl")
        assertTrue(cases.isNotEmpty())
        for (c in cases) {
            val expected = c.result as? String ?: ""
            assertEquals(c.args.opt(0)?.toString(), expected, safePlaceUrl(c.args.opt(0)))
        }
    }

    @Test
    fun normalizePlaceInformationMatchesTheWebClient() {
        val file = Fixtures.load("place-information.json")
        val cases = Fixtures.cases(file, "normalizePlaceInformation")
        assertTrue(cases.isNotEmpty())
        for (c in cases) {
            val actual = normalizePlaceInformation(c.args.optJSONObject(0))
            assertTrue("Mismatch for ${c.args}: expected=${c.result}, actual=$actual", Fixtures.same(c.result, actual))
        }
    }

    @Test
    fun fixtureComparisonToleratesFloatingPointNoiseOnly() {
        assertTrue(Fixtures.same(JSONObject("""{"a":[1,2.5],"b":null}"""), JSONObject("""{"b":null,"a":[1.0,2.5000000000001]}""")))
        assertFalse(Fixtures.same(JSONObject("""{"a":1}"""), JSONObject("""{"a":1,"b":2}""")))
        assertFalse(Fixtures.same(JSONArray("[1,2]"), JSONArray("[2,1]")))
    }
}
